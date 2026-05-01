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
        items: items
            .into_iter()
            .map(|t| TodoItemExport {
                id: t.id,
                title: t.title,
                description: t.description,
                status: t.status,
                created_at: t.created_at,
                updated_at: t.updated_at,
            })
            .collect(),
        deps: deps
            .into_iter()
            .map(|d| TodoDepExport {
                todo_id: d.todo_id,
                depends_on: d.depends_on,
            })
            .collect(),
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

    if !tables.is_empty() {
        available.push(SectionId::CustomTables);
    }
    Some(tables)
}
