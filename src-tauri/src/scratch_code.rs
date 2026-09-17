use crate::scratch_core::{ScratchDocument, ScratchSnapshot, ScratchState};
use serde::Deserialize;

const MAX_PART_BYTES: usize = 1_000_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchPartEdit {
    part: String,
    content: String,
}

fn apply_part(mut document: ScratchDocument, edit: ScratchPartEdit) -> Result<ScratchDocument, String> {
    if edit.content.len() > MAX_PART_BYTES {
        return Err("scratch file is too large".to_string());
    }

    match edit.part.as_str() {
        "html" => document.html = edit.content,
        "css" => document.css = edit.content,
        "js" => document.js = edit.content,
        _ => return Err(format!("unsupported scratch file: {}", edit.part)),
    }

    Ok(document)
}

#[tauri::command]
pub fn scratch_edit_part(
    edit: ScratchPartEdit,
    state: tauri::State<'_, ScratchState>,
) -> Result<ScratchSnapshot, String> {
    let document = state.document()?;
    let next = apply_part(document, edit)?;
    state.replace_document(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> ScratchDocument {
        ScratchDocument {
            html: "<main></main>".to_string(),
            css: "main {}".to_string(),
            js: "console.log('ok')".to_string(),
        }
    }

    #[test]
    fn edits_only_requested_part() {
        let next = apply_part(
            document(),
            ScratchPartEdit {
                part: "css".to_string(),
                content: "main { color: red; }".to_string(),
            },
        )
        .unwrap();

        assert_eq!(next.html, "<main></main>");
        assert_eq!(next.css, "main { color: red; }");
        assert_eq!(next.js, "console.log('ok')");
    }
}
