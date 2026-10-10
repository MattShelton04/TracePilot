//! Start-time lookups every platform can test: the `/proc` and `ps` output
//! parsers, the batch lookup, and on unix the `ps` lookup macOS uses.

use super::{process_start_time, process_start_times, start_time};
#[cfg(unix)]
use std::process::Command;

#[test]
fn proc_stat_start_is_field_22_counted_after_the_command_name() {
    let stat = "109 (claude) S 99 94 0 0 -1 4194304 765465 20443050 1621 12330 \
                4784 1093 58406 10959 20 0 13 0 439 5739892736 96092";
    assert_eq!(
        start_time::parse_proc_stat_start(stat).as_deref(),
        Some("439")
    );
    // A command name with spaces and a `)` does not shift the fields.
    let odd = "7 (a) b (c)) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 98765 1 1";
    assert_eq!(
        start_time::parse_proc_stat_start(odd).as_deref(),
        Some("98765")
    );
    assert_eq!(start_time::parse_proc_stat_start("7 (short) S 1"), None);
    assert_eq!(start_time::parse_proc_stat_start("garbage"), None);
}

#[test]
fn ps_start_times_are_parsed_per_requested_pid() {
    let parse = start_time::parse_ps_start_times;
    // `ps` right-aligns the pid; tabs and CRLF are tolerated too.
    let output = concat!(
        "  101 Sat Oct 10 02:37:47 2026\n",
        "\t202\tSat Oct  3 09:05:01 2026  \r\n",
        "303 Fri Oct  9 23:59:59 2026\n",
    );
    let starts = parse(output, &[101, 202, 404]);
    assert_eq!(starts.len(), 2, "{starts:?}");
    assert_eq!(starts[&101], "Sat Oct 10 02:37:47 2026");
    // The padded day keeps `ps`'s spacing; only the ends are trimmed.
    assert_eq!(starts[&202], "Sat Oct  3 09:05:01 2026");
    // 303 was not asked about and 404 has no process: both absent.
    assert!(!starts.contains_key(&303) && !starts.contains_key(&404));
}

#[test]
fn ps_start_times_skip_lines_of_another_shape() {
    let output = concat!(
        "ps: some warning\n",
        "\n",
        "101\n",
        "101x Sat Oct 10 02:37:47 2026\n",
        "99999999999 Sat Oct 10 02:37:47 2026\n",
        "-7 Sat Oct 10 02:37:47 2026\n",
        "PID STARTED\n",
        "7 Thu Jan  1 00:00:00 1970",
    );
    let starts = start_time::parse_ps_start_times(output, &[7, 101]);
    assert_eq!(starts.len(), 1, "{starts:?}");
    assert_eq!(starts[&7], "Thu Jan  1 00:00:00 1970");
    assert!(start_time::parse_ps_start_times("", &[7]).is_empty());
    assert!(start_time::parse_ps_start_times(output, &[]).is_empty());
}

/// A pid listed twice keeps its first time, so a later line cannot pass a
/// reused pid off as the process a pid file recorded.
#[test]
fn ps_start_times_keep_the_first_line_for_a_pid() {
    let output = "42 Sat Oct 10 02:37:47 2026\n42 Sun Oct 11 08:00:00 2026\n";
    let starts = start_time::parse_ps_start_times(output, &[42]);
    assert_eq!(starts[&42], "Sat Oct 10 02:37:47 2026");
}

/// On macOS `i32::MAX` is past the pid range, so it is left out before `ps`
/// runs.
#[test]
fn process_start_times_match_single_lookups() {
    let own = std::process::id();
    let missing = i32::MAX as u32;
    let starts = process_start_times(&[own, missing, own]);
    assert_eq!(starts.len(), 1, "{starts:?}");
    assert_eq!(starts.get(&own).cloned(), process_start_time(own));
    assert!(process_start_times(&[]).is_empty());
}

#[cfg(unix)]
#[test]
fn ps_start_times_read_live_processes_in_one_batch() {
    let lookup = |pids: &[u32]| start_time::ps_start_times_within(pids, 30);
    let own = std::process::id();
    let mut child = Command::new("sleep").arg("30").spawn().expect("sleep");
    let other = child.id();
    let missing = i32::MAX as u32;
    let starts = lookup(&[own, missing, other]);
    let child_start = lookup(&[other]).remove(&other);
    child.kill().unwrap();
    child.wait().unwrap();

    assert_eq!(starts.len(), 2, "{starts:?}");
    // `lstart` in the C locale: weekday, month, day, time and year.
    assert_eq!(starts[&own].split_whitespace().count(), 5, "{starts:?}");
    assert_eq!(starts.get(&other), child_start.as_ref());
    // A batch reads each pid exactly as asking for it alone does.
    assert_eq!(lookup(&[own]).remove(&own).as_ref(), starts.get(&own));
    assert!(lookup(&[missing]).is_empty());
    assert!(lookup(&[]).is_empty());
    // A pid `ps` rejects outright does not hide the others.
    let rejected = lookup(&[own, u32::MAX]);
    assert_eq!(rejected.get(&own), starts.get(&own), "{rejected:?}");
}

/// Live pids only, all within every `ps`'s range, so this is one real batch
/// rather than the ask-each-pid-alone fallback.
#[cfg(unix)]
#[test]
fn ps_start_times_batch_live_pids_and_drop_a_reaped_one() {
    let lookup = |pids: &[u32]| start_time::ps_start_times_within(pids, 30);
    let own = std::process::id();
    let mut child = Command::new("sleep").arg("30").spawn().expect("sleep");
    let other = child.id();
    let both = lookup(&[own, other]);
    child.kill().unwrap();
    child.wait().unwrap();
    assert_eq!(both.len(), 2, "{both:?}");
    assert!(both.contains_key(&own) && both.contains_key(&other));

    let mut done = Command::new("true").spawn().expect("true");
    let reaped = done.id();
    done.wait().unwrap();
    let starts = lookup(&[own, reaped]);
    assert_eq!(starts.get(&own), both.get(&own), "{starts:?}");
    assert!(!starts.contains_key(&reaped), "{starts:?}");
}

#[cfg(unix)]
#[test]
fn process_start_time_is_stable_for_a_live_process() {
    let own = process_start_time(std::process::id()).expect("own start time");
    assert_eq!(process_start_time(std::process::id()), Some(own));
    assert_eq!(process_start_time(i32::MAX as u32), None);
}
