// crates/jeikcode-core/src/config/instructions.rs
//
// Two-tier layered instruction system: global → project. (The former
// `.jeikcode.user.md` user tier was removed; the ACTIVE prompt loader lives in
// `jeikcode-capabilities/src/session/instructions.rs` — this module backs the
// `/status` + `/init` display only.)
//
// 1. Global:  ~/.jeikcode/AGENTS.md or ~/.jeikcode/JEIKCODE.md — personal preferences
//             across all projects
// 2. Project: <project>/AGENTS.md (open standard), .jeikcode.md, JEIKCODE.md,
//             CLAUDE.md, or claude.md (first match wins; CLAUDE.md/claude.md are
//             accepted for compatibility with projects migrating from Claude Code)

use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct InstructionFile {
    pub path: PathBuf,
    pub content: String,
    pub level: InstructionLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstructionLevel {
    Global,
    Project,
}

impl InstructionLevel {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Global => "GLOBAL",
            Self::Project => "PROJECT",
        }
    }
}

impl std::fmt::Display for InstructionLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.label())
    }
}

pub struct LayeredInstructions {
    pub global: Option<InstructionFile>,
    pub project: Option<InstructionFile>,
}

impl LayeredInstructions {
    /// Load both instruction tiers from disk.
    ///
    /// - Global:  `~/.jeikcode/AGENTS.md` → `~/.jeikcode/JEIKCODE.md`
    /// - Project: `<project_root>/AGENTS.md` (open standard), `.jeikcode.md`,
    ///   `JEIKCODE.md`, `CLAUDE.md`, or `claude.md` (first match wins)
    pub fn load(project_root: &Path) -> Self {
        let config_dir = crate::config::Config::config_dir();
        let global = Self::try_load(&config_dir.join("AGENTS.md"), InstructionLevel::Global)
            .or_else(|| Self::try_load(&config_dir.join("JEIKCODE.md"), InstructionLevel::Global));

        // Lookup order matches the ACTIVE prompt loader: AGENTS.md (open standard) first,
        // then native JeikCode names, then Claude Code names.
        let project = [
            "AGENTS.md",
            ".jeikcode.md",
            "JEIKCODE.md",
            "CLAUDE.md",
            "claude.md",
        ]
        .iter()
        .find_map(|name| Self::try_load(&project_root.join(name), InstructionLevel::Project));

        Self { global, project }
    }

    fn try_load(path: &Path, level: InstructionLevel) -> Option<InstructionFile> {
        let content = std::fs::read_to_string(path).ok()?;
        if content.trim().is_empty() {
            return None;
        }
        // No size cap: full-file load (matches session hot-reload policy).
        Some(InstructionFile {
            path: path.to_path_buf(),
            content,
            level,
        })
    }

    /// Merge both levels into prompt text. Low priority first, high last
    /// (recency effect: project > global).
    pub fn merged(&self) -> String {
        let mut parts = Vec::new();
        if let Some(ref g) = self.global {
            parts.push(format!(
                "=== {} INSTRUCTIONS ({}) ===\n{}",
                g.level.label(),
                g.path.display(),
                g.content.trim()
            ));
        }
        if let Some(ref p) = self.project {
            parts.push(format!(
                "=== {} INSTRUCTIONS ({}) ===\n{}",
                p.level.label(),
                p.path.display(),
                p.content.trim()
            ));
        }
        parts.join("\n\n")
    }

    /// Return status for both levels with either the loaded path or the
    /// preferred path to create when that level is missing.
    pub fn status_lines(&self, project_root: &Path) -> Vec<InstructionStatusLine> {
        vec![
            InstructionStatusLine::new(
                InstructionLevel::Global,
                self.global.as_ref(),
                crate::config::Config::config_dir().join("JEIKCODE.md"),
            ),
            InstructionStatusLine::new(
                InstructionLevel::Project,
                self.project.as_ref(),
                project_root.join(".jeikcode.md"),
            ),
        ]
    }

    pub fn has_any(&self) -> bool {
        self.global.is_some() || self.project.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstructionStatusLine {
    pub level: InstructionLevel,
    pub path: PathBuf,
    pub found: bool,
}

impl InstructionStatusLine {
    fn new(
        level: InstructionLevel,
        loaded: Option<&InstructionFile>,
        missing_path: PathBuf,
    ) -> Self {
        Self {
            level,
            path: loaded
                .map(|instruction| instruction.path.clone())
                .unwrap_or(missing_path),
            found: loaded.is_some(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn empty_dir_produces_no_instructions() {
        let tmp = tempfile::tempdir().unwrap();
        let instructions = LayeredInstructions {
            global: None,
            project: LayeredInstructions::try_load(
                &tmp.path().join(".jeikcode.md"),
                InstructionLevel::Project,
            ),
        };
        assert!(!instructions.has_any());
        assert!(instructions.merged().is_empty());
    }

    #[test]
    fn project_jeikcode_md_is_found() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".jeikcode.md"), "Use tabs.").unwrap();
        let instructions = LayeredInstructions::try_load(
            &tmp.path().join(".jeikcode.md"),
            InstructionLevel::Project,
        );
        assert!(instructions.is_some());
        let f = instructions.unwrap();
        assert_eq!(f.level, InstructionLevel::Project);
        assert!(f.content.contains("Use tabs."));
    }

    #[test]
    fn agents_md_used_as_project_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("AGENTS.md"), "from AGENTS.md open standard").unwrap();
        let instructions = LayeredInstructions::load(tmp.path());
        let project = instructions
            .project
            .expect("AGENTS.md should be loaded as project tier");
        assert_eq!(project.level, InstructionLevel::Project);
        assert!(project.content.contains("from AGENTS.md open standard"));
        assert!(project.path.ends_with("AGENTS.md"));
    }

    #[test]
    fn agents_md_preferred_over_jeikcode_md() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("AGENTS.md"), "agents wins").unwrap();
        fs::write(tmp.path().join(".jeikcode.md"), "jeikcode loses").unwrap();
        let instructions = LayeredInstructions::load(tmp.path());
        let project = instructions.project.expect("project tier should load");
        assert!(project.content.contains("agents wins"));
    }

    #[test]
    fn claude_md_used_as_project_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("CLAUDE.md"), "from Claude Code").unwrap();
        let instructions = LayeredInstructions::load(tmp.path());
        let project = instructions
            .project
            .expect("CLAUDE.md should be loaded as project tier");
        assert_eq!(project.level, InstructionLevel::Project);
        assert!(project.content.contains("from Claude Code"));
        assert!(project.path.ends_with("CLAUDE.md"));
    }

    #[test]
    fn lowercase_claude_md_used_as_project_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("claude.md"), "lowercase claude").unwrap();
        let instructions = LayeredInstructions::load(tmp.path());
        let project = instructions
            .project
            .expect("claude.md should be loaded as project tier");
        assert!(project.content.contains("lowercase claude"));
    }

    #[test]
    fn jeikcode_md_preferred_over_claude_md() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".jeikcode.md"), "jeikcode wins").unwrap();
        fs::write(tmp.path().join("CLAUDE.md"), "claude loses").unwrap();
        let instructions = LayeredInstructions::load(tmp.path());
        let project = instructions.project.expect("project tier should load");
        assert!(project.content.contains("jeikcode wins"));
    }

    #[test]
    fn agents_md_preferred_over_claude_md() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("AGENTS.md"), "agents wins").unwrap();
        fs::write(tmp.path().join("CLAUDE.md"), "claude loses").unwrap();
        let instructions = LayeredInstructions::load(tmp.path());
        let project = instructions.project.expect("project tier should load");
        assert!(project.content.contains("agents wins"));
    }

    #[test]
    fn jeikcode_uppercase_preferred_over_claude_md() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("JEIKCODE.md"), "JEIKCODE wins").unwrap();
        fs::write(tmp.path().join("CLAUDE.md"), "claude loses").unwrap();
        let instructions = LayeredInstructions::load(tmp.path());
        let project = instructions.project.expect("project tier should load");
        assert!(project.content.contains("JEIKCODE wins"));
    }

    #[test]
    fn lowercase_preferred_over_uppercase() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".jeikcode.md"), "lowercase wins").unwrap();
        fs::write(tmp.path().join("JEIKCODE.md"), "uppercase loses").unwrap();
        let instructions = LayeredInstructions::load(tmp.path());
        let project = instructions.project.expect("project tier should load");
        assert!(project.content.contains("lowercase wins"));
        assert!(project.path.ends_with(".jeikcode.md"));
    }

    #[test]
    fn empty_file_is_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".jeikcode.md"), "   \n  \n").unwrap();
        let project = LayeredInstructions::try_load(
            &tmp.path().join(".jeikcode.md"),
            InstructionLevel::Project,
        );
        assert!(project.is_none());
    }

    #[test]
    fn merged_output_order_is_global_then_project() {
        let tmp = tempfile::tempdir().unwrap();
        let instructions = LayeredInstructions {
            global: Some(InstructionFile {
                path: tmp.path().join("global.md"),
                content: "GLOBAL_CONTENT".to_string(),
                level: InstructionLevel::Global,
            }),
            project: Some(InstructionFile {
                path: tmp.path().join("project.md"),
                content: "PROJECT_CONTENT".to_string(),
                level: InstructionLevel::Project,
            }),
        };
        let merged = instructions.merged();
        let global_pos = merged.find("GLOBAL_CONTENT").unwrap();
        let project_pos = merged.find("PROJECT_CONTENT").unwrap();
        assert!(global_pos < project_pos, "global must come before project");
    }

    #[test]
    fn status_lines_show_both_levels() {
        let tmp = tempfile::tempdir().unwrap();
        let instructions = LayeredInstructions {
            global: Some(InstructionFile {
                path: tmp.path().join("g.md"),
                content: "g".to_string(),
                level: InstructionLevel::Global,
            }),
            project: None,
        };
        let lines = instructions.status_lines(tmp.path());
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].level, InstructionLevel::Global);
        assert!(lines[0].found);
        assert!(lines[0].path.ends_with("g.md"));
        assert_eq!(lines[1].level, InstructionLevel::Project);
        assert!(!lines[1].found);
        assert_eq!(lines[1].path, tmp.path().join(".jeikcode.md"));
    }

    #[test]
    fn large_file_is_not_truncated() {
        let tmp = tempfile::tempdir().unwrap();
        let big = format!("head-{}-tail", "x".repeat(1_100_000));
        fs::write(tmp.path().join("big.md"), &big).unwrap();
        let loaded =
            LayeredInstructions::try_load(&tmp.path().join("big.md"), InstructionLevel::Global);
        assert!(loaded.is_some());
        let f = loaded.unwrap();
        assert!(!f.content.contains("[Truncated"));
        assert!(f.content.contains("head-") && f.content.contains("-tail"));
        assert_eq!(f.content.len(), big.len());
    }

    #[test]
    fn has_any_returns_true_when_any_level_loaded() {
        let instructions = LayeredInstructions {
            global: None,
            project: Some(InstructionFile {
                path: PathBuf::from("/tmp/p.md"),
                content: "p".to_string(),
                level: InstructionLevel::Project,
            }),
        };
        assert!(instructions.has_any());
    }

    #[test]
    fn has_any_returns_false_when_all_none() {
        let instructions = LayeredInstructions {
            global: None,
            project: None,
        };
        assert!(!instructions.has_any());
    }

    #[test]
    fn level_labels_are_correct() {
        assert_eq!(InstructionLevel::Global.label(), "GLOBAL");
        assert_eq!(InstructionLevel::Project.label(), "PROJECT");
    }

    #[test]
    fn merged_with_only_project_produces_single_section() {
        let instructions = LayeredInstructions {
            global: None,
            project: Some(InstructionFile {
                path: PathBuf::from("/project/.jeikcode.md"),
                content: "Only project rules".to_string(),
                level: InstructionLevel::Project,
            }),
        };
        let merged = instructions.merged();
        assert!(merged.contains("=== PROJECT INSTRUCTIONS"));
        assert!(merged.contains("Only project rules"));
        assert!(!merged.contains("GLOBAL"));
        assert!(!merged.contains("USER"));
    }
}
