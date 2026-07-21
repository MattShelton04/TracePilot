//! Bounded, sanitized raster-image previews for the session explorer.

use super::security::{
    reject_hidden_filename, revalidate_within_session_dir, safe_session_file_path,
};
use super::types::{
    MAX_IMAGE_DIMENSION, MAX_IMAGE_INPUT_BYTES, MAX_IMAGE_PIXELS, MAX_IMAGE_PREVIEW_BYTES,
    MAX_IMAGE_PREVIEW_EDGE, SessionFileType, SessionImagePreview,
};
use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use base64::Engine as _;
use image::{DynamicImage, GenericImageView, ImageFormat, ImageReader, Limits};
use std::io::{Cursor, Read as _};

fn supported_format(format: ImageFormat) -> Option<&'static str> {
    match format {
        ImageFormat::Png => Some("png"),
        ImageFormat::Jpeg => Some("jpeg"),
        ImageFormat::WebP => Some("webp"),
        ImageFormat::Gif => Some("gif"),
        _ => None,
    }
}

fn encode_sanitized_png(image: &DynamicImage) -> Result<Vec<u8>, BindingsError> {
    let mut encoded = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut encoded), ImageFormat::Png)
        .map_err(|e| {
            BindingsError::Validation(format!("Failed to encode safe image preview: {e}"))
        })?;
    Ok(encoded)
}

fn build_image_preview(bytes: &[u8]) -> Result<SessionImagePreview, BindingsError> {
    let probe = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| BindingsError::Validation(format!("Failed to inspect image: {e}")))?;
    let format = probe
        .format()
        .and_then(supported_format)
        .ok_or_else(|| BindingsError::Validation("Unsupported or spoofed image format".into()))?;
    let (original_width, original_height) = probe
        .into_dimensions()
        .map_err(|e| BindingsError::Validation(format!("Failed to read image dimensions: {e}")))?;

    let pixels = u64::from(original_width)
        .checked_mul(u64::from(original_height))
        .ok_or_else(|| BindingsError::Validation("Image dimensions overflow".into()))?;
    if original_width == 0 || original_height == 0 {
        return Err(BindingsError::Validation(
            "Image dimensions must be non-zero".into(),
        ));
    }
    if original_width > MAX_IMAGE_DIMENSION
        || original_height > MAX_IMAGE_DIMENSION
        || pixels > MAX_IMAGE_PIXELS
    {
        return Err(BindingsError::Validation(format!(
            "Image dimensions exceed the safe preview limit ({}x{}, {} megapixels)",
            MAX_IMAGE_DIMENSION,
            MAX_IMAGE_DIMENSION,
            MAX_IMAGE_PIXELS / 1_000_000
        )));
    }

    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| BindingsError::Validation(format!("Failed to inspect image: {e}")))?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_IMAGE_PIXELS * 4 + 16 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|e| BindingsError::Validation(format!("Failed to decode image safely: {e}")))?;

    let mut was_downscaled =
        original_width > MAX_IMAGE_PREVIEW_EDGE || original_height > MAX_IMAGE_PREVIEW_EDGE;
    let mut preview = if was_downscaled {
        decoded.thumbnail(MAX_IMAGE_PREVIEW_EDGE, MAX_IMAGE_PREVIEW_EDGE)
    } else {
        decoded
    };
    let mut encoded = encode_sanitized_png(&preview)?;

    // Noisy photos encoded as PNG can exceed the desired IPC budget even
    // after the normal 4096px resize. Fall back to 2048px and try once more.
    if encoded.len() > MAX_IMAGE_PREVIEW_BYTES
        && (preview.width() > 2_048 || preview.height() > 2_048)
    {
        preview = preview.thumbnail(2_048, 2_048);
        was_downscaled = true;
        encoded = encode_sanitized_png(&preview)?;
    }
    if encoded.len() > MAX_IMAGE_PREVIEW_BYTES {
        return Err(BindingsError::Validation(
            "Sanitized image preview is too large to display".into(),
        ));
    }

    let (width, height) = preview.dimensions();
    Ok(SessionImagePreview {
        base64_data: base64::engine::general_purpose::STANDARD.encode(encoded),
        width,
        height,
        original_width,
        original_height,
        original_size_bytes: bytes.len() as u64,
        original_format: format.to_string(),
        was_downscaled,
        animation_omitted: format == "gif",
    })
}

/// Decode an allow-listed raster image and return a bounded, metadata-free PNG.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id, %relative_path))]
pub async fn session_read_image_preview(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    relative_path: String,
) -> CmdResult<SessionImagePreview> {
    crate::validators::validate_session_id(&session_id)?;
    let session_state_dir = read_config(&state).session_state_dir();

    blocking_cmd!({
        let session_dir = session_state_dir.join(&session_id);
        let file_path = safe_session_file_path(&session_dir, &relative_path)?;
        if !file_path.exists() {
            return Err(BindingsError::Validation(format!(
                "File not found: {relative_path}"
            )));
        }
        let file_path = revalidate_within_session_dir(&session_dir, &file_path)?;
        if file_path.is_dir() {
            return Err(BindingsError::Validation(format!(
                "'{relative_path}' is a directory, not an image"
            )));
        }
        reject_hidden_filename(&file_path)?;

        let file_name = file_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        if SessionFileType::from_name(&file_name) != SessionFileType::Image {
            return Err(BindingsError::Validation(format!(
                "'{relative_path}' is not a supported image file"
            )));
        }

        let file = std::fs::File::open(&file_path)?;
        let mut bytes = Vec::new();
        let count = file
            .take(MAX_IMAGE_INPUT_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if count > MAX_IMAGE_INPUT_BYTES as usize {
            return Err(BindingsError::Validation(format!(
                "Image exceeds the {} MiB preview limit",
                MAX_IMAGE_INPUT_BYTES / (1024 * 1024)
            )));
        }
        build_image_preview(&bytes)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageEncoder as _;

    #[test]
    fn supported_formats_are_explicitly_allowlisted() {
        assert_eq!(supported_format(ImageFormat::Png), Some("png"));
        assert_eq!(supported_format(ImageFormat::Jpeg), Some("jpeg"));
        assert_eq!(supported_format(ImageFormat::WebP), Some("webp"));
        assert_eq!(supported_format(ImageFormat::Gif), Some("gif"));
        assert_eq!(supported_format(ImageFormat::Bmp), None);
    }

    #[test]
    fn valid_image_is_reencoded_as_a_sanitized_png() {
        let source = DynamicImage::new_rgba8(4, 3);
        let mut bytes = Vec::new();
        source
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();

        let preview = build_image_preview(&bytes).unwrap();
        assert_eq!((preview.width, preview.height), (4, 3));
        assert_eq!(preview.original_format, "png");
        assert!(!preview.was_downscaled);

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(preview.base64_data)
            .unwrap();
        assert!(decoded.starts_with(b"\x89PNG\r\n\x1a\n"));
    }

    #[test]
    fn malformed_or_spoofed_bytes_are_rejected() {
        assert!(build_image_preview(b"not an image").is_err());
    }

    #[test]
    fn over_limit_dimensions_are_rejected_before_decode() {
        let width = MAX_IMAGE_DIMENSION + 1;
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(
                &vec![0; width as usize * 4],
                width,
                1,
                image::ExtendedColorType::Rgba8,
            )
            .unwrap();

        let error = build_image_preview(&bytes).unwrap_err();
        assert!(error.to_string().contains("safe preview limit"));
    }
}
