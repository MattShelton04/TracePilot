pub(crate) fn make_workspace_yaml(session_id: &str, day_offset: usize) -> String {
    let day = (day_offset % 28) + 1;
    format!(
        "id: {session_id}\n\
         cwd: /bench/project\n\
         repository: github.com/bench/project\n\
         branch: main\n\
         host_type: cli\n\
         created_at: \"2025-01-{day:02}T00:00:00Z\"\n\
         updated_at: \"2025-01-{day:02}T01:00:00Z\"\n"
    )
}
