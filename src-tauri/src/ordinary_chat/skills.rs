use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, path::Path};

const MAX_SKILL_BYTES: u64 = 512 * 1024;

pub(crate) fn selected_skill_context(selected_ids: &[String]) -> Result<Option<String>, String> {
    if selected_ids.is_empty() {
        return Ok(None);
    }
    let selected = selected_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let overview = crate::backend::list_codex_skills_value(None);
    let skills = overview
        .get("skills")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut sections = Vec::new();
    for skill in skills {
        let Some(id) = skill.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !selected.contains(id) {
            continue;
        }
        let name = skill.get("name").and_then(Value::as_str).unwrap_or("Skill");
        let path = skill
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Skill {name} 缺少本地路径"))?;
        let content = read_skill(Path::new(path))?;
        let digest = format!("{:x}", Sha256::digest(content.as_bytes()));
        sections.push(format!(
            "## Skill: {name}\n来源: {path}\n版本摘要: {}\n\n{}",
            &digest[..12],
            strip_frontmatter(&content)
        ));
    }
    if sections.is_empty() {
        return Ok(None);
    }
    Ok(Some(format!(
        "用户为当前普通聊天显式启用了以下本地 Skills。它们是工作方式和领域说明，不代表你拥有 Agent 工具；只有在与用户问题相关时才应用。\n\n{}",
        sections.join("\n\n---\n\n")
    )))
}

fn read_skill(path: &Path) -> Result<String, String> {
    let canonical = fs::canonicalize(path).map_err(|_| "选中的 Skill 文件不存在".to_string())?;
    if canonical.file_name().and_then(|value| value.to_str()) != Some("SKILL.md") {
        return Err("Skill 路径必须指向 SKILL.md".to_string());
    }
    let metadata = canonical
        .metadata()
        .map_err(|error| format!("读取 Skill 信息失败: {error}"))?;
    if metadata.len() > MAX_SKILL_BYTES {
        return Err("单个 Skill 不能超过 512 KB".to_string());
    }
    fs::read_to_string(canonical).map_err(|error| format!("读取 Skill 失败: {error}"))
}

fn strip_frontmatter(content: &str) -> &str {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return trimmed;
    }
    let Some(rest) = trimmed.strip_prefix("---") else {
        return trimmed;
    };
    let Some((_, body)) = rest.split_once("\n---") else {
        return trimmed;
    };
    body.trim_start_matches(['\r', '\n'])
}

#[cfg(test)]
mod tests {
    use super::strip_frontmatter;

    #[test]
    fn strips_skill_frontmatter() {
        assert_eq!(
            strip_frontmatter("---\nname: demo\ndescription: test\n---\n\n# Instructions"),
            "# Instructions"
        );
    }
}
