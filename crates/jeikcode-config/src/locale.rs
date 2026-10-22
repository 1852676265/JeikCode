use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum Locale {
    #[serde(rename = "en")]
    En,
    #[serde(rename = "vi-VN")]
    Vi,
    #[serde(rename = "zh_CN")]
    ZhCn,
    #[serde(rename = "zh_TW")]
    ZhTw,
    #[serde(rename = "ja")]
    Ja,
    #[serde(rename = "ko")]
    Ko,
    #[serde(rename = "ru")]
    Ru,
    #[serde(rename = "fr")]
    Fr,
    #[serde(rename = "es")]
    Es,
    #[serde(rename = "de")]
    De,
    #[serde(rename = "ar")]
    Ar,
}

/// Compatibility name for callers referring to the UI language as `Lang`.
pub type Lang = Locale;

impl Locale {
    pub fn is_vi(self) -> bool {
        self == Self::Vi
    }

    pub const fn as_u8(self) -> u8 {
        match self {
            Self::ZhCn => 0,
            Self::En => 1,
            Self::Vi => 2,
            Self::ZhTw => 3,
            Self::Ja => 4,
            Self::Ko => 5,
            Self::Ru => 6,
            Self::Fr => 7,
            Self::Es => 8,
            Self::De => 9,
            Self::Ar => 10,
        }
    }

    pub const fn from_u8(val: u8) -> Self {
        match val {
            0 => Self::ZhCn,
            2 => Self::Vi,
            3 => Self::ZhTw,
            4 => Self::Ja,
            5 => Self::Ko,
            6 => Self::Ru,
            7 => Self::Fr,
            8 => Self::Es,
            9 => Self::De,
            10 => Self::Ar,
            _ => Self::En,
        }
    }

    pub fn native_name(self) -> &'static str {
        match self {
            Self::En => "English",
            Self::Vi => "Tiếng Việt",
            Self::ZhCn => "简体中文",
            Self::ZhTw => "繁體中文",
            Self::Ja => "日本語",
            Self::Ko => "한국어",
            Self::Ru => "Русский",
            Self::Fr => "Français",
            Self::Es => "Español",
            Self::De => "Deutsch",
            Self::Ar => "العربية",
        }
    }

    /// Canonical key shared by the daemon and language selectors.
    pub fn language_key(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::Vi => "vi-VN",
            Self::ZhCn => "zh-CN",
            Self::ZhTw => "zh-TW",
            Self::Ja => "ja",
            Self::Ko => "ko",
            Self::Ru => "ru",
            Self::Fr => "fr",
            Self::Es => "es",
            Self::De => "de",
            Self::Ar => "ar",
        }
    }
}

impl<'de> Deserialize<'de> for Locale {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct LocaleVisitor;

        impl<'de> serde::de::Visitor<'de> for LocaleVisitor {
            type Value = Locale;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a locale string like 'en', 'vi-VN', 'zh_CN', 'zh-CN', or 'zh'")
            }

            fn visit_str<E>(self, value: &str) -> Result<Locale, E>
            where
                E: serde::de::Error,
            {
                Locale::from_str(value).map_err(serde::de::Error::custom)
            }
        }

        deserializer.deserialize_str(LocaleVisitor)
    }
}

impl Default for Locale {
    fn default() -> Self {
        Locale::En
    }
}

impl fmt::Display for Locale {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Locale::En => write!(f, "en"),
            Locale::Vi => write!(f, "vi-VN"),
            Locale::ZhCn => write!(f, "zh_CN"),
            Locale::ZhTw => write!(f, "zh_TW"),
            Locale::Ja => write!(f, "ja"),
            Locale::Ko => write!(f, "ko"),
            Locale::Ru => write!(f, "ru"),
            Locale::Fr => write!(f, "fr"),
            Locale::Es => write!(f, "es"),
            Locale::De => write!(f, "de"),
            Locale::Ar => write!(f, "ar"),
        }
    }
}

impl FromStr for Locale {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let normalized = s.trim().to_ascii_lowercase().replace('-', "_");
        match normalized.as_str() {
            "vi" | "vi_vn" => Ok(Locale::Vi),
            "en" | "english" | "en_us" | "en_gb" | "en_ca" | "en_au" => Ok(Locale::En),
            "zh" | "zh_cn" | "zh_hans" | "chinese" | "简体中文" => Ok(Locale::ZhCn),
            "zh_tw" | "zh_hk" | "zh_mo" | "zh_hant" | "繁體中文" | "繁体中文" => {
                Ok(Locale::ZhTw)
            }
            "ja" | "ja_jp" | "japanese" | "日本語" => Ok(Locale::Ja),
            "ko" | "ko_kr" | "korean" | "한국어" => Ok(Locale::Ko),
            "ru" | "ru_ru" | "russian" | "русский" => Ok(Locale::Ru),
            "fr" | "fr_fr" | "fr_ca" | "french" | "français" | "francais" => Ok(Locale::Fr),
            "es" | "es_es" | "es_mx" | "spanish" | "español" | "espanol" => Ok(Locale::Es),
            "de" | "de_de" | "de_at" | "de_ch" | "german" | "deutsch" => Ok(Locale::De),
            "ar" | "ar_sa" | "ar_eg" | "ar_ae" | "arabic" | "العربية" => Ok(Locale::Ar),
            other => {
                if other.starts_with("en") {
                    Ok(Locale::En)
                } else if other.starts_with("zh_tw")
                    || other.starts_with("zh_hk")
                    || other.starts_with("zh_hant")
                {
                    Ok(Locale::ZhTw)
                } else if other.starts_with("zh") || other.contains("中文") {
                    Ok(Locale::ZhCn)
                } else if other.starts_with("ja") {
                    Ok(Locale::Ja)
                } else if other.starts_with("ko") {
                    Ok(Locale::Ko)
                } else if other.starts_with("ru") {
                    Ok(Locale::Ru)
                } else if other.starts_with("fr") {
                    Ok(Locale::Fr)
                } else if other.starts_with("es") {
                    Ok(Locale::Es)
                } else if other.starts_with("de") {
                    Ok(Locale::De)
                } else if other.starts_with("ar") {
                    Ok(Locale::Ar)
                } else {
                    Err(format!("unsupported locale: {s}"))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vietnamese_aliases_and_canonical_serialization() {
        for alias in ["vi", "vi-VN", "vi_VN", "vi-vn", "vi_vn", "VI-VN"] {
            assert_eq!(alias.parse::<Lang>().unwrap(), Lang::Vi);
            assert_eq!(
                serde_json::from_str::<Locale>(&format!("\"{alias}\"")).unwrap(),
                Locale::Vi
            );
        }
        assert_eq!(serde_json::to_string(&Locale::Vi).unwrap(), "\"vi-VN\"");
        assert_eq!(Locale::Vi.to_string(), "vi-VN");
        assert_eq!(Locale::Vi.native_name(), "Tiếng Việt");
        assert!(Locale::Vi.is_vi());
        assert!(!Locale::En.is_vi());
        for invalid in ["vi-VN-extra", "vietnamese", "vi_US"] {
            assert!(invalid.parse::<Locale>().is_err());
        }
        for locale in [
            Locale::En,
            Locale::Vi,
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::Ja,
            Locale::Ko,
            Locale::Ru,
            Locale::Fr,
            Locale::Es,
            Locale::De,
            Locale::Ar,
        ] {
            assert_eq!(locale.to_string().parse::<Locale>().unwrap(), locale);
        }
    }

    #[test]
    fn locale_u8_encoding_roundtrips() {
        for locale in [
            Locale::ZhCn,
            Locale::En,
            Locale::Vi,
            Locale::ZhTw,
            Locale::Ja,
            Locale::Ko,
            Locale::Ru,
            Locale::Fr,
            Locale::Es,
            Locale::De,
            Locale::Ar,
        ] {
            assert_eq!(Locale::from_u8(locale.as_u8()), locale);
        }
        assert_eq!(Locale::from_u8(99), Locale::En);
    }

    #[test]
    fn explicit_language_and_atomic_snapshot_precedence() {
        use crate::i18n;
        let _guard = i18n::test_lock();
        let env_zh = |_: &str| Some("zh_CN.UTF-8".to_string());
        // Unconfigured detects OS locale (zh_CN -> ZhCn)
        assert_eq!(
            i18n::resolve_initial_locale_with_env(None, None, &env_zh),
            Locale::ZhCn
        );
        // Explicit config overrides OS locale
        for locale in [Locale::En, Locale::Vi, Locale::ZhCn] {
            assert_eq!(
                i18n::resolve_initial_locale_with_env(None, Some(locale), &env_zh),
                locale
            );
            i18n::set_locale(locale);
            assert_eq!(i18n::current_locale(), locale);
        }
        // CLI flag overrides both config and OS
        assert_eq!(
            i18n::resolve_initial_locale_with_env(Some("vi"), Some(Locale::ZhCn), &env_zh),
            Locale::Vi
        );
        // Unsupported OS locale falls back to English baseline
        let env_unsupported = |_: &str| Some("it_IT.UTF-8".to_string());
        assert_eq!(
            i18n::resolve_initial_locale_with_env(None, None, &env_unsupported),
            Locale::En
        );
    }

    #[test]
    fn display_round_trips_through_from_str() {
        assert_eq!(
            Locale::En.to_string().parse::<Locale>().unwrap(),
            Locale::En
        );
        assert_eq!(
            Locale::ZhCn.to_string().parse::<Locale>().unwrap(),
            Locale::ZhCn
        );
    }

    #[test]
    fn from_str_accepts_common_aliases() {
        assert_eq!("en".parse::<Locale>().unwrap(), Locale::En);
        assert_eq!("English".parse::<Locale>().unwrap(), Locale::En);
        assert_eq!("zh".parse::<Locale>().unwrap(), Locale::ZhCn);
        assert_eq!("zh_CN".parse::<Locale>().unwrap(), Locale::ZhCn);
        assert_eq!("zh-cn".parse::<Locale>().unwrap(), Locale::ZhCn);
        assert_eq!("简体中文".parse::<Locale>().unwrap(), Locale::ZhCn);
        // zh_TW / zh_HK parse to ZhTw
        assert_eq!("zh_TW".parse::<Locale>().unwrap(), Locale::ZhTw);
        assert_eq!("zh-tw".parse::<Locale>().unwrap(), Locale::ZhTw);
        assert_eq!("zh_HK".parse::<Locale>().unwrap(), Locale::ZhTw);
        assert_eq!("zh-hk".parse::<Locale>().unwrap(), Locale::ZhTw);
        assert_eq!("繁體中文".parse::<Locale>().unwrap(), Locale::ZhTw);
        assert_eq!("ja".parse::<Locale>().unwrap(), Locale::Ja);
        assert_eq!("ko".parse::<Locale>().unwrap(), Locale::Ko);
        assert_eq!("ru".parse::<Locale>().unwrap(), Locale::Ru);
        assert_eq!("fr".parse::<Locale>().unwrap(), Locale::Fr);
        assert_eq!("es".parse::<Locale>().unwrap(), Locale::Es);
        assert_eq!("de".parse::<Locale>().unwrap(), Locale::De);
        assert_eq!("ar".parse::<Locale>().unwrap(), Locale::Ar);
    }

    #[test]
    fn from_str_rejects_unknown() {
        assert!("xx_unsupported".parse::<Locale>().is_err());
        assert!("".parse::<Locale>().is_err());
    }

    #[test]
    fn serde_uses_short_keys() {
        let s = serde_json::to_string(&Locale::ZhCn).unwrap();
        assert_eq!(s, r#""zh_CN""#);
        let parsed: Locale = serde_json::from_str(r#""en""#).unwrap();
        assert_eq!(parsed, Locale::En);
        let parsed_hyphen: Locale = serde_json::from_str(r#""zh-CN""#).unwrap();
        assert_eq!(parsed_hyphen, Locale::ZhCn);
        let toml_parsed: toml::Value = toml::from_str(r#"language = "zh-CN""#).unwrap();
        let lang: Option<Locale> = toml_parsed
            .get("language")
            .unwrap()
            .clone()
            .try_into()
            .unwrap();
        assert_eq!(lang, Some(Locale::ZhCn));

        for val in &[
            "zh-CN",
            "zh_CN",
            "zh-cn",
            "zh_cn",
            "ZH-CN",
            "ZH_CN",
            "zh",
            "ZH",
            "简体中文",
        ] {
            let toml_doc: toml::Value = toml::from_str(&format!(r#"language = "{val}""#)).unwrap();
            let parsed_lang: Option<Locale> = toml_doc
                .get("language")
                .unwrap()
                .clone()
                .try_into()
                .unwrap();
            assert_eq!(parsed_lang, Some(Locale::ZhCn), "failed for {val}");
        }

        for val in &["zh-TW", "zh_TW"] {
            let toml_doc: toml::Value = toml::from_str(&format!(r#"language = "{val}""#)).unwrap();
            let parsed_lang: Option<Locale> = toml_doc
                .get("language")
                .unwrap()
                .clone()
                .try_into()
                .unwrap();
            assert_eq!(parsed_lang, Some(Locale::ZhTw), "failed for {val}");
        }

        for val in &[
            "en", "EN", "en-US", "en_US", "en-us", "en_us", "English", "english",
        ] {
            let toml_doc: toml::Value = toml::from_str(&format!(r#"language = "{val}""#)).unwrap();
            let parsed_lang: Option<Locale> = toml_doc
                .get("language")
                .unwrap()
                .clone()
                .try_into()
                .unwrap();
            assert_eq!(parsed_lang, Some(Locale::En), "failed for {val}");
        }
    }
}
