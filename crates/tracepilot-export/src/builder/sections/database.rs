use std::path::Path;

use crate::document::{CustomTableExport, SectionId, TodoDepExport, TodoExport, TodoItemExport};
use crate::options::ExportOptions;
use tracepilot_core::parsing::session_db::{
    list_tables, read_custom_table, read_todo_deps, read_todos,
};

pub(in crate::builder) fn build_todos(
    options: &ExportOptions,
    session_dir: &Path,
    available: &mut Vec<SectionId>,
) -> Option<TodoExport> {
    if !options.includes(SectionId::Todos) {
        return None;
    }
    let db_path = session_dir.join("session.db");
    if !db_path.exists() {
        return None;
    }

    let items = match read_todos(&db_path) {
        Ok(todos) => todos,
        Err(e) => {
            tracing::warn!(
                path = %db_path.display(),
                error = %e,
                "Failed to read todos from session database, returning empty list"
            );
            Vec::new()
        }
    };

    let deps = match read_todo_deps(&db_path) {
        Ok(deps) => deps,
        Err(e) => {
            tracing::warn!(
                path = %db_path.display(),
                error = %e,
                "Failed to read todo dependencies from session database, returning empty list"
            );
            Vec::new()
        }
    };

    let export = TodoExport {
        items: items.into_iter().map(TodoItemExport::from).collect(),
        deps: deps.into_iter().map(TodoDepExport::from).collect(),
    };

    if !export.items.is_empty() {
        available.push(SectionId::Todos);
    }
    Some(export)
}

pub(in crate::builder) fn build_custom_tables(
    options: &ExportOptions,
    session_dir: &Path,
    available: &mut Vec<SectionId>,
) -> Option<Vec<CustomTableExport>> {
    if !options.includes(SectionId::CustomTables) {
        return None;
    }
    let db_path = session_dir.join("session.db");
    if !db_path.exists() {
        return None;
    }

    let table_names = match list_tables(&db_path) {
        Ok(names) => names,
        Err(e) => {
            tracing::warn!(
                path = %db_path.display(),
                error = %e,
                "Failed to list tables in session database, skipping custom tables"
            );
            return None;
        }
    };

    // Exclude standard tables — only export custom ones
    let standard = ["todos", "todo_deps"];
    let custom_names = table_names
        .into_iter()
        .filter(|name| !standard.contains(&name.as_str()))
        .collect::<Vec<_>>();

    if custom_names.is_empty() {
        return None;
    }

    let mut tables = Vec::new();
    for name in custom_names {
        match read_custom_table(&db_path, &name) {
            Ok(info) => {
                // Convert ordered Vec<Vec<Value>> rows back to HashMap for the
                // export document format (markdown renderer and redactor access
                // values by column name).
                let rows = info
                    .rows
                    .into_iter()
                    .map(|row_vec| info.columns.iter().cloned().zip(row_vec).collect())
                    .collect();
                tables.push(CustomTableExport {
                    name: info.name,
                    columns: info.columns,
                    rows,
                });
            }
            Err(e) => {
                tracing::warn!(
                    path = %db_path.display(),
                    table = %name,
                    error = %e,
                    "Failed to read custom table, skipping"
                );
            }
        }
    }

    // Tables that exist but hold no rows give the section nothing to show.
    if tables.iter().any(|table| !table.rows.is_empty()) {
        available.push(SectionId::CustomTables);
    }
    Some(tables)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::options::ExportFormat;

    fn build(sql: &str) -> (Option<Vec<CustomTableExport>>, Vec<SectionId>) {
        let dir = tempfile::tempdir().unwrap();
        rusqlite::Connection::open(dir.path().join("session.db"))
            .unwrap()
            .execute_batch(sql)
            .unwrap();
        let mut available = Vec::new();
        let options = ExportOptions::all(ExportFormat::Json);
        let tables = build_custom_tables(&options, dir.path(), &mut available);
        (tables, available)
    }

    /// Tables that exist but hold nothing don't make the section available.
    #[test]
    fn empty_custom_tables_are_not_an_available_section() {
        let (tables, available) =
            build("CREATE TABLE notes (body TEXT); CREATE TABLE tags (name TEXT);");
        assert_eq!(tables.map(|t| t.len()), Some(2));
        assert!(
            !available.contains(&SectionId::CustomTables),
            "{available:?}"
        );
    }

    #[test]
    fn a_custom_table_with_rows_is_an_available_section() {
        let (tables, available) = build(
            "CREATE TABLE notes (body TEXT); CREATE TABLE tags (name TEXT); \
             INSERT INTO tags VALUES ('release');",
        );
        let tables = tables.unwrap();
        assert_eq!(tables.iter().map(|t| t.rows.len()).sum::<usize>(), 1);
        assert!(
            available.contains(&SectionId::CustomTables),
            "{available:?}"
        );
    }
}
