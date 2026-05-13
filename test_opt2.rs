fn main() {
    let sql_prefix = "INSERT";
    let num_rows = 2;
    let params_per_row = 2;

    let mut sql = String::with_capacity(
        sql_prefix.len() + 1 + num_rows * (params_per_row * 2 + 1) + num_rows - 1,
    );
    sql.push_str(sql_prefix);
    sql.push(' ');

    let mut row_str = String::with_capacity(params_per_row * 2 + 2);
    row_str.push_str(",(?");
    for _ in 1..params_per_row {
        row_str.push_str(",?");
    }
    row_str.push(')');

    sql.push_str(&row_str[1..]);
    for _ in 1..num_rows {
        sql.push_str(&row_str);
    }

    println!("{}", sql);
}
