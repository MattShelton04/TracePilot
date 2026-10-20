//! Splitting a shell command into segments of unquoted words. Quotes,
//! escapes, PowerShell here-strings, heredocs, comments and redirections are
//! read the way bash and PowerShell would, closely enough that text inside
//! them never starts a segment.

/// One word of a shell command, unquoted.
#[derive(Debug, Default)]
pub(super) struct Token {
    pub(super) text: String,
    /// It holds a `$` outside single quotes: its value isn't knowable.
    pub(super) expands: bool,
}

/// Split a command into segments of words, honoring quotes.
pub(super) fn segments(command: &str) -> Vec<Vec<Token>> {
    let mut lexer = Lexer::default();
    let mut chars = command.chars().peekable();
    let mut heredocs: Vec<String> = Vec::new();
    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                lexer.started = true;
                for c in chars.by_ref() {
                    if c == '\'' {
                        break;
                    }
                    lexer.token.text.push(c);
                }
            }
            '"' => {
                lexer.started = true;
                while let Some(c) = chars.next() {
                    match c {
                        '"' => break,
                        // bash: `\"`, `\\`, `` \` ``, `\$`; PowerShell: `` `" ``.
                        '\\' if chars
                            .peek()
                            .is_some_and(|c| matches!(c, '"' | '\\' | '`' | '$')) =>
                        {
                            lexer.token.text.extend(chars.next());
                        }
                        '`' if chars.peek() == Some(&'"') => {
                            lexer.token.text.extend(chars.next());
                        }
                        '$' => {
                            lexer.token.expands = true;
                            lexer.token.text.push(c);
                        }
                        _ => lexer.token.text.push(c),
                    }
                }
            }
            '@' if !lexer.started && matches!(chars.peek(), Some('\'' | '"')) => {
                // A PowerShell here-string: its body is data, up to `'@`/`"@`
                // at the start of a line.
                let quote = chars.next().unwrap_or('\'');
                let close = format!("\n{quote}@");
                let rest: String = chars.clone().collect();
                let end = rest.find(&close).map_or(rest.len(), |i| i + close.len());
                for _ in rest[..end].chars() {
                    chars.next();
                }
                lexer.token.text.push_str("@here");
                lexer.token.expands = true;
                lexer.started = true;
            }
            '#' if !lexer.started => {
                // A comment, to the end of the line.
                while chars.peek().is_some_and(|c| *c != '\n') {
                    chars.next();
                }
            }
            '>' => {
                // A redirection: `2>&1`, `> file`, `2>$null`, `*>&1`.
                let fd = &lexer.token.text;
                if fd.is_empty() || fd == "*" || fd.bytes().all(|b| b.is_ascii_digit()) {
                    lexer.token = Token::default();
                    lexer.started = false;
                } else {
                    lexer.end_token();
                }
                chars.next_if_eq(&'>');
                if chars.next_if_eq(&'&').is_some() {
                    while chars.next_if(|c| c.is_ascii_digit() || *c == '-').is_some() {}
                } else {
                    lexer.skip_word = true;
                }
            }
            '<' if chars.peek() != Some(&'<') => {
                lexer.end_token();
                lexer.skip_word = true;
            }
            '<' => {
                chars.next();
                if chars.peek() == Some(&'<') {
                    // `<<<` here-string: one word follows.
                    chars.next();
                    continue;
                }
                chars.next_if_eq(&'-');
                while chars.next_if(|c| *c == ' ' || *c == '\t').is_some() {}
                let mut word = String::new();
                while let Some(c) = chars.next_if(|c| !c.is_whitespace() && !";|&<>()".contains(*c))
                {
                    if c != '\'' && c != '"' {
                        word.push(c);
                    }
                }
                if !word.is_empty() {
                    heredocs.push(word);
                }
                lexer.end_token();
            }
            '\\' | '`' if chars.peek() == Some(&'\n') => {
                chars.next();
            }
            '\\' | '`' if chars.peek() == Some(&'\r') => {
                chars.next();
                chars.next_if_eq(&'\n');
            }
            '\\' => {
                if let Some(next) = chars.next() {
                    lexer.started = true;
                    lexer.token.text.push(next);
                }
            }
            '$' => {
                lexer.started = true;
                lexer.token.expands = true;
                lexer.token.text.push(c);
            }
            '\n' => {
                lexer.end_segment();
                for word in heredocs.drain(..) {
                    // Skip the body, through the line that is the delimiter.
                    let mut line = String::new();
                    for c in chars.by_ref() {
                        if c == '\n' {
                            if line.trim() == word {
                                break;
                            }
                            line.clear();
                        } else {
                            line.push(c);
                        }
                    }
                }
            }
            ';' | '|' | '&' | '(' | ')' | '{' | '}' | '`' => lexer.end_segment(),
            c if c.is_whitespace() => lexer.end_token(),
            c => {
                lexer.started = true;
                lexer.token.text.push(c);
            }
        }
    }
    lexer.end_segment();
    lexer.segments
}

#[derive(Default)]
struct Lexer {
    token: Token,
    /// The current token has begun (it may be an empty quoted string).
    started: bool,
    /// The next word is a redirection's target, not an argument.
    skip_word: bool,
    segment: Vec<Token>,
    segments: Vec<Vec<Token>>,
}

impl Lexer {
    fn end_token(&mut self) {
        if self.started {
            let token = std::mem::take(&mut self.token);
            if !std::mem::take(&mut self.skip_word) {
                self.segment.push(token);
            }
        }
        self.token = Token::default();
        self.started = false;
    }

    fn end_segment(&mut self) {
        self.end_token();
        self.skip_word = false;
        if !self.segment.is_empty() {
            self.segments.push(std::mem::take(&mut self.segment));
        }
    }
}
