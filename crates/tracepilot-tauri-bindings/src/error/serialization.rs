use serde::ser::SerializeStruct;

use super::{BindingsError, ErrorCode, scrub_message};

// Tauri v2 requires command return errors to implement `Into<InvokeError>`.
// The canonical approach is to implement `Serialize` so Tauri can convert it.
//
// Wire format (stable contract — see module docs):
//   { "code": "ALREADY_INDEXING", "message": "Indexing is already in progress." }
//
// ## Info-leak audit (Phase 1A, wave 3)
//
// `self.to_string()` below pulls `Display` from the wrapped source error for
// every `#[error(transparent)]` variant. Each variant's sensitivity:
//
// | Variant          | Leak risk | Why                                              |
// |------------------|-----------|--------------------------------------------------|
// | `Io`             | HIGH      | `std::io::Error` includes full filesystem paths  |
// | `Tauri`          | HIGH      | May include file paths and Windows usernames     |
// | `TomlSerialize`  | MEDIUM    | May echo config key names (generally OK)         |
// | `TomlDeserialize`| HIGH      | Echoes config file content snippets              |
// | `Reqwest`        | MEDIUM    | URLs may contain bearer tokens in query strings  |
// | `Core` / `Orch.` / `Bridge` / `Indexer` / `Export` | HIGH | These wrap paths freely internally              |
// | `Join`           | LOW       | Task-panic strings, usually safe                 |
// | `Semver`, `Uuid` | LOW       | Echo user input which is already in scope        |
// | `AlreadyIndexing`, `Validation`, `Internal` | SAFE | Authored strings, no interpolation  |
//
// We run every message through [`scrub_message`] before sending to the
// frontend, which:
//   1. Replaces `C:\Users\<name>\` (and POSIX `/home/<name>/`) with a
//      generic placeholder so screenshots / error telemetry don't expose
//      the OS account name.
//   2. Redacts `Authorization: Bearer <token>`, `token=...`, and
//      GitHub PAT patterns (`ghp_*`, `gho_*`, `ghu_*`, `ghs_*`, `ghr_*`)
//      from anywhere in the message.
//
// The original un-scrubbed message is still available via `Display` for
// server-side logs (where the path context is useful for debugging and
// there is no screenshot / telemetry egress). If you need to change what
// gets scrubbed, update `scrub_message` *and* the variant table above.
impl serde::Serialize for BindingsError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut s = serializer.serialize_struct("BindingsError", 2)?;
        s.serialize_field("code", self.code().as_str())?;
        s.serialize_field("message", &scrub_message(&self.to_string()))?;
        s.end()
    }
}

// ── specta::Type forwarding for the Phase 1B.1 pilot ─────────────
//
// `BindingsError` wraps a handful of foreign error types (`std::io::Error`,
// `tauri::Error`, etc.) that do not implement `specta::Type`, so we can't
// derive `Type` directly. For codegen purposes the *only* shape the
// frontend ever sees is the `{ code, message }` envelope produced by the
// manual `Serialize` impl above. We surface that shape to specta via a
// small proxy struct + a forwarding `Type` impl.
//
// This means `Result<T, BindingsError>` on a specta-annotated command
// generates `Result<T, BindingsErrorIpc>` in `bindings.ts`, which is
// exactly what consumers should pattern-match against.
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct BindingsErrorIpc {
    code: ErrorCode,
    message: String,
}

impl specta::Type for BindingsError {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        <BindingsErrorIpc as specta::Type>::definition(types)
    }
}
