use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_KEYS: [&str; 8] = [
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyF",
    "KeyJ",
    "KeyK",
    "KeyL",
    "Semicolon",
];
const DEFAULT_PROFILE_ID: &str = "__kps_default__";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct KeyAppearance {
    pub accent: String,
    pub key_background: String,
    pub key_text: String,
    pub key_border: String,
    pub key_opacity: f64,
    pub key_radius: u32,
    pub key_border_width: u32,
    pub pressed_text: String,
    pub pressed_border: String,
    pub key_font_preset: String,
    pub key_font_size: u32,
    pub key_font_weight: u32,
    pub press_depth: u32,
    pub press_scale: u32,
    pub press_animation_ms: u32,
    pub minimum_highlight_ms: u32,
}

impl Default for KeyAppearance {
    fn default() -> Self {
        Self {
            accent: default_accent().to_string(),
            key_background: default_key_background(),
            key_text: default_key_text(),
            key_border: default_key_border(),
            key_opacity: default_key_opacity(),
            key_radius: default_key_radius(),
            key_border_width: default_key_border_width(),
            pressed_text: default_pressed_text(),
            pressed_border: default_pressed_border(),
            key_font_preset: default_key_font_preset(),
            key_font_size: default_key_font_size(),
            key_font_weight: default_key_font_weight(),
            press_depth: default_press_depth(),
            press_scale: default_press_scale(),
            press_animation_ms: default_press_animation_ms(),
            minimum_highlight_ms: default_minimum_highlight_ms(),
        }
    }
}

impl KeyAppearance {
    fn normalize(&mut self) {
        self.accent = normalize_color(&self.accent, default_accent());
        self.key_background =
            normalize_color(&self.key_background, default_key_background().as_str());
        self.key_text = normalize_color(&self.key_text, default_key_text().as_str());
        self.key_border = normalize_color(&self.key_border, default_key_border().as_str());
        self.key_opacity = if self.key_opacity.is_finite() {
            self.key_opacity.clamp(0.35, 1.0)
        } else {
            default_key_opacity()
        };
        self.key_radius = self.key_radius.clamp(0, 24);
        self.key_border_width = self.key_border_width.clamp(0, 8);
        self.pressed_text = normalize_color(&self.pressed_text, default_pressed_text().as_str());
        self.pressed_border =
            normalize_color(&self.pressed_border, default_pressed_border().as_str());
        self.key_font_preset = normalize_font_preset(&self.key_font_preset);
        self.key_font_size = self.key_font_size.clamp(8, 64);
        self.key_font_weight = self.key_font_weight.clamp(400, 900);
        self.press_depth = self.press_depth.clamp(0, 16);
        self.press_scale = self.press_scale.clamp(90, 105);
        self.press_animation_ms = self.press_animation_ms.clamp(0, 250);
        self.minimum_highlight_ms = self.minimum_highlight_ms.clamp(0, 250);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutKey {
    pub id: String,
    pub physical_code: String,
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[serde(default)]
    pub appearance: Option<KeyAppearance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OutputMode {
    #[default]
    Off,
    Overlay,
    Obs,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameProfile {
    pub id: String,
    pub name: String,
    pub process_name: String,
    pub selected_keys: Vec<String>,
    pub layout_keys: Vec<LayoutKey>,
    pub accent: String,
    #[serde(default = "default_key_background")]
    pub key_background: String,
    #[serde(default = "default_key_text")]
    pub key_text: String,
    #[serde(default = "default_key_border")]
    pub key_border: String,
    #[serde(default = "default_key_opacity")]
    pub key_opacity: f64,
    #[serde(default = "default_key_radius")]
    pub key_radius: u32,
    #[serde(default = "default_key_border_width")]
    pub key_border_width: u32,
    #[serde(default = "default_pressed_text")]
    pub pressed_text: String,
    #[serde(default = "default_pressed_border")]
    pub pressed_border: String,
    #[serde(default = "default_key_font_preset")]
    pub key_font_preset: String,
    #[serde(default = "default_key_font_size")]
    pub key_font_size: u32,
    #[serde(default = "default_key_font_weight")]
    pub key_font_weight: u32,
    #[serde(default = "default_kps_font_preset")]
    pub kps_font_preset: String,
    #[serde(default = "default_kps_value_size")]
    pub kps_value_size: u32,
    #[serde(default = "default_kps_label_size")]
    pub kps_label_size: u32,
    #[serde(default = "default_kps_font_weight")]
    pub kps_font_weight: u32,
    #[serde(default = "default_press_depth")]
    pub press_depth: u32,
    #[serde(default = "default_press_scale")]
    pub press_scale: u32,
    #[serde(default = "default_press_animation_ms")]
    pub press_animation_ms: u32,
    #[serde(default = "default_minimum_highlight_ms")]
    pub minimum_highlight_ms: u32,
    pub key_size: u32,
    pub key_gap: u32,
    pub show_kps: bool,
    pub kps_x: f64,
    pub kps_y: f64,
    pub snap_to_grid: bool,
    pub grid_size: u32,
}

impl GameProfile {
    fn from_settings(
        settings: &AppSettings,
        id: String,
        name: String,
        process_name: String,
    ) -> Self {
        Self {
            id,
            name,
            process_name,
            selected_keys: settings.selected_keys.clone(),
            layout_keys: settings.layout_keys.clone(),
            accent: settings.accent.clone(),
            key_background: settings.key_background.clone(),
            key_text: settings.key_text.clone(),
            key_border: settings.key_border.clone(),
            key_opacity: settings.key_opacity,
            key_radius: settings.key_radius,
            key_border_width: settings.key_border_width,
            pressed_text: settings.pressed_text.clone(),
            pressed_border: settings.pressed_border.clone(),
            key_font_preset: settings.key_font_preset.clone(),
            key_font_size: settings.key_font_size,
            key_font_weight: settings.key_font_weight,
            kps_font_preset: settings.kps_font_preset.clone(),
            kps_value_size: settings.kps_value_size,
            kps_label_size: settings.kps_label_size,
            kps_font_weight: settings.kps_font_weight,
            press_depth: settings.press_depth,
            press_scale: settings.press_scale,
            press_animation_ms: settings.press_animation_ms,
            minimum_highlight_ms: settings.minimum_highlight_ms,
            key_size: settings.key_size,
            key_gap: settings.key_gap,
            show_kps: settings.show_kps,
            kps_x: settings.kps_x,
            kps_y: settings.kps_y,
            snap_to_grid: settings.snap_to_grid,
            grid_size: settings.grid_size,
        }
    }

    pub fn update_from_settings(&mut self, settings: &AppSettings) {
        self.selected_keys = settings.selected_keys.clone();
        self.layout_keys = settings.layout_keys.clone();
        self.accent = settings.accent.clone();
        self.key_background = settings.key_background.clone();
        self.key_text = settings.key_text.clone();
        self.key_border = settings.key_border.clone();
        self.key_opacity = settings.key_opacity;
        self.key_radius = settings.key_radius;
        self.key_border_width = settings.key_border_width;
        self.pressed_text = settings.pressed_text.clone();
        self.pressed_border = settings.pressed_border.clone();
        self.key_font_preset = settings.key_font_preset.clone();
        self.key_font_size = settings.key_font_size;
        self.key_font_weight = settings.key_font_weight;
        self.kps_font_preset = settings.kps_font_preset.clone();
        self.kps_value_size = settings.kps_value_size;
        self.kps_label_size = settings.kps_label_size;
        self.kps_font_weight = settings.kps_font_weight;
        self.press_depth = settings.press_depth;
        self.press_scale = settings.press_scale;
        self.press_animation_ms = settings.press_animation_ms;
        self.minimum_highlight_ms = settings.minimum_highlight_ms;
        self.key_size = settings.key_size;
        self.key_gap = settings.key_gap;
        self.show_kps = settings.show_kps;
        self.kps_x = settings.kps_x;
        self.kps_y = settings.kps_y;
        self.snap_to_grid = settings.snap_to_grid;
        self.grid_size = settings.grid_size;
    }

    pub fn apply_to_settings(&self, settings: &mut AppSettings) {
        settings.selected_keys = self.selected_keys.clone();
        settings.layout_keys = self.layout_keys.clone();
        settings.accent = self.accent.clone();
        settings.key_background = self.key_background.clone();
        settings.key_text = self.key_text.clone();
        settings.key_border = self.key_border.clone();
        settings.key_opacity = self.key_opacity;
        settings.key_radius = self.key_radius;
        settings.key_border_width = self.key_border_width;
        settings.pressed_text = self.pressed_text.clone();
        settings.pressed_border = self.pressed_border.clone();
        settings.key_font_preset = self.key_font_preset.clone();
        settings.key_font_size = self.key_font_size;
        settings.key_font_weight = self.key_font_weight;
        settings.kps_font_preset = self.kps_font_preset.clone();
        settings.kps_value_size = self.kps_value_size;
        settings.kps_label_size = self.kps_label_size;
        settings.kps_font_weight = self.kps_font_weight;
        settings.press_depth = self.press_depth;
        settings.press_scale = self.press_scale;
        settings.press_animation_ms = self.press_animation_ms;
        settings.minimum_highlight_ms = self.minimum_highlight_ms;
        settings.key_size = self.key_size;
        settings.key_gap = self.key_gap;
        settings.show_kps = self.show_kps;
        settings.kps_x = self.kps_x;
        settings.kps_y = self.kps_y;
        settings.snap_to_grid = self.snap_to_grid;
        settings.grid_size = self.grid_size;
    }

    fn normalize(&mut self) {
        if self.layout_keys.is_empty() && !self.selected_keys.is_empty() {
            self.layout_keys = layout_from_owned_codes(&self.selected_keys);
        }

        let mut seen = HashSet::new();
        self.layout_keys.retain_mut(|key| {
            key.physical_code = legacy_key_to_code(&key.physical_code);
            if key.id.trim().is_empty() {
                key.id = format!("key-{}", key.physical_code);
            }
            if key.label.trim().is_empty() {
                key.label = display_label(&key.physical_code);
            }
            key.x = if key.x.is_finite() {
                key.x.clamp(0.0, 100.0)
            } else {
                0.0
            };
            key.y = if key.y.is_finite() {
                key.y.clamp(0.0, 100.0)
            } else {
                0.0
            };
            key.width = key.width.map(|width| width.clamp(28, 200));
            key.height = key.height.map(|height| height.clamp(28, 200));
            if let Some(appearance) = key.appearance.as_mut() {
                appearance.normalize();
            }
            seen.insert(key.physical_code.clone())
        });
        self.selected_keys = self
            .layout_keys
            .iter()
            .map(|key| key.physical_code.clone())
            .collect();
        self.accent = normalize_color(&self.accent, default_accent());
        self.key_background =
            normalize_color(&self.key_background, default_key_background().as_str());
        self.key_text = normalize_color(&self.key_text, default_key_text().as_str());
        self.key_border = normalize_color(&self.key_border, default_key_border().as_str());
        self.key_opacity = if self.key_opacity.is_finite() {
            self.key_opacity.clamp(0.35, 1.0)
        } else {
            default_key_opacity()
        };
        self.key_radius = self.key_radius.clamp(0, 24);
        self.key_border_width = self.key_border_width.clamp(0, 8);
        self.pressed_text = normalize_color(&self.pressed_text, default_pressed_text().as_str());
        self.pressed_border =
            normalize_color(&self.pressed_border, default_pressed_border().as_str());
        self.key_font_preset = normalize_font_preset(&self.key_font_preset);
        self.key_font_size = self.key_font_size.clamp(8, 64);
        self.key_font_weight = self.key_font_weight.clamp(400, 900);
        self.kps_font_preset = normalize_font_preset(&self.kps_font_preset);
        self.kps_value_size = self.kps_value_size.clamp(12, 120);
        self.kps_label_size = self.kps_label_size.clamp(7, 32);
        self.kps_font_weight = self.kps_font_weight.clamp(400, 900);
        self.press_depth = self.press_depth.clamp(0, 16);
        self.press_scale = self.press_scale.clamp(90, 105);
        self.press_animation_ms = self.press_animation_ms.clamp(0, 250);
        self.minimum_highlight_ms = self.minimum_highlight_ms.clamp(0, 250);
        self.key_size = self.key_size.clamp(36, 200);
        self.grid_size = self.grid_size.clamp(1, 20);
        self.kps_x = if self.kps_x.is_finite() {
            self.kps_x.clamp(0.0, 100.0)
        } else {
            default_kps_x()
        };
        self.kps_y = if self.kps_y.is_finite() {
            self.kps_y.clamp(0.0, 100.0)
        } else {
            default_kps_y()
        };
        self.name = if self.name.trim().is_empty() {
            "Untitled profile".to_string()
        } else {
            self.name.trim().to_string()
        };
        self.process_name = self.process_name.trim().to_string();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub settings_version: u32,
    pub selected_keys: Vec<String>,
    #[serde(default)]
    pub layout_keys: Vec<LayoutKey>,
    pub output_mode: OutputMode,
    #[serde(default, skip_serializing)]
    pub output_windows_open: bool,
    #[serde(default, skip_serializing)]
    pub capture_enabled: bool,
    pub click_through: bool,
    pub show_when_target_active: bool,
    pub target_process: Option<String>,
    pub accent: String,
    #[serde(default = "default_key_background")]
    pub key_background: String,
    #[serde(default = "default_key_text")]
    pub key_text: String,
    #[serde(default = "default_key_border")]
    pub key_border: String,
    #[serde(default = "default_key_opacity")]
    pub key_opacity: f64,
    #[serde(default = "default_key_radius")]
    pub key_radius: u32,
    #[serde(default = "default_key_border_width")]
    pub key_border_width: u32,
    #[serde(default = "default_pressed_text")]
    pub pressed_text: String,
    #[serde(default = "default_pressed_border")]
    pub pressed_border: String,
    #[serde(default = "default_key_font_preset")]
    pub key_font_preset: String,
    #[serde(default = "default_key_font_size")]
    pub key_font_size: u32,
    #[serde(default = "default_key_font_weight")]
    pub key_font_weight: u32,
    #[serde(default = "default_kps_font_preset")]
    pub kps_font_preset: String,
    #[serde(default = "default_kps_value_size")]
    pub kps_value_size: u32,
    #[serde(default = "default_kps_label_size")]
    pub kps_label_size: u32,
    #[serde(default = "default_kps_font_weight")]
    pub kps_font_weight: u32,
    #[serde(default = "default_press_depth")]
    pub press_depth: u32,
    #[serde(default = "default_press_scale")]
    pub press_scale: u32,
    #[serde(default = "default_press_animation_ms")]
    pub press_animation_ms: u32,
    #[serde(default = "default_minimum_highlight_ms")]
    pub minimum_highlight_ms: u32,
    pub key_size: u32,
    pub key_gap: u32,
    pub show_kps: bool,
    #[serde(default = "default_kps_x")]
    pub kps_x: f64,
    #[serde(default = "default_kps_y")]
    pub kps_y: f64,
    #[serde(default = "default_snap_to_grid")]
    pub snap_to_grid: bool,
    #[serde(default = "default_grid_size")]
    pub grid_size: u32,
    #[serde(default = "default_obs_key_color")]
    pub obs_key_color: String,
    #[serde(default)]
    pub overlay_position: Option<WindowPosition>,
    #[serde(default)]
    pub obs_position: Option<WindowPosition>,
    #[serde(default)]
    pub overlay_size: Option<WindowSize>,
    #[serde(default)]
    pub obs_size: Option<WindowSize>,
    #[serde(default)]
    pub profiles: Vec<GameProfile>,
    #[serde(default)]
    pub default_profile: Option<GameProfile>,
    #[serde(default)]
    pub active_profile_id: Option<String>,
    #[serde(default = "default_profile_auto_switch")]
    pub profile_auto_switch: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppearancePatch {
    pub accent: Option<String>,
    pub key_background: Option<String>,
    pub key_text: Option<String>,
    pub key_border: Option<String>,
    pub key_opacity: Option<f64>,
    pub key_radius: Option<u32>,
    pub key_border_width: Option<u32>,
    pub pressed_text: Option<String>,
    pub pressed_border: Option<String>,
    pub key_font_preset: Option<String>,
    pub key_font_size: Option<u32>,
    pub key_font_weight: Option<u32>,
    pub kps_font_preset: Option<String>,
    pub kps_value_size: Option<u32>,
    pub kps_label_size: Option<u32>,
    pub kps_font_weight: Option<u32>,
    pub press_depth: Option<u32>,
    pub press_scale: Option<u32>,
    pub press_animation_ms: Option<u32>,
    pub minimum_highlight_ms: Option<u32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LayoutOptionsPatch {
    pub key_size: Option<u32>,
    pub snap_to_grid: Option<bool>,
    pub grid_size: Option<u32>,
    pub show_kps: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SettingsMutation {
    AddKey {
        key: LayoutKey,
    },
    RemoveKey {
        id: String,
    },
    ClearKeys,
    ResetKeys,
    SetKeyLabel {
        id: String,
        label: String,
    },
    SetKeySize {
        id: String,
        width: u32,
        height: u32,
    },
    ClearKeySize {
        id: String,
    },
    MoveKey {
        id: String,
        x: f64,
        y: f64,
    },
    MoveKps {
        x: f64,
        y: f64,
    },
    SetLayoutOptions {
        patch: LayoutOptionsPatch,
    },
    SetGlobalAppearance {
        patch: AppearancePatch,
    },
    ResetGlobalAppearance,
    SetKeyAppearance {
        id: String,
        appearance: Option<KeyAppearance>,
    },
    UpdateKeyAppearance {
        id: String,
        patch: AppearancePatch,
    },
    ResetKeySettings {
        id: String,
    },
    CreateProfile {
        name: Option<String>,
        process_name: Option<String>,
    },
    UpdateProfileDetails {
        id: String,
        name: Option<String>,
        process_name: Option<String>,
    },
    DeleteProfile {
        id: String,
    },
    ActivateProfile {
        id: String,
    },
    SetProfileAutoSwitch {
        enabled: bool,
    },
    SetOutputMode {
        mode: OutputMode,
    },
    SetObsColor {
        color: String,
    },
    SetClickThrough {
        enabled: bool,
    },
    SetTargetFilter {
        enabled: bool,
        process_name: Option<String>,
    },
}

impl Default for AppSettings {
    fn default() -> Self {
        let selected_keys = DEFAULT_KEYS.iter().map(|key| (*key).to_string()).collect();
        Self {
            settings_version: 9,
            layout_keys: layout_from_codes(&DEFAULT_KEYS),
            selected_keys,
            output_mode: OutputMode::Off,
            output_windows_open: false,
            capture_enabled: false,
            click_through: true,
            show_when_target_active: false,
            target_process: None,
            accent: default_accent().to_string(),
            key_background: default_key_background().to_string(),
            key_text: default_key_text().to_string(),
            key_border: default_key_border().to_string(),
            key_opacity: default_key_opacity(),
            key_radius: default_key_radius(),
            key_border_width: default_key_border_width(),
            pressed_text: default_pressed_text(),
            pressed_border: default_pressed_border(),
            key_font_preset: default_key_font_preset(),
            key_font_size: default_key_font_size(),
            key_font_weight: default_key_font_weight(),
            kps_font_preset: default_kps_font_preset(),
            kps_value_size: default_kps_value_size(),
            kps_label_size: default_kps_label_size(),
            kps_font_weight: default_kps_font_weight(),
            press_depth: default_press_depth(),
            press_scale: default_press_scale(),
            press_animation_ms: default_press_animation_ms(),
            minimum_highlight_ms: default_minimum_highlight_ms(),
            key_size: 100,
            key_gap: 10,
            show_kps: true,
            kps_x: default_kps_x(),
            kps_y: default_kps_y(),
            snap_to_grid: true,
            grid_size: default_grid_size(),
            obs_key_color: default_obs_key_color(),
            overlay_position: None,
            obs_position: None,
            overlay_size: None,
            obs_size: None,
            profiles: Vec::new(),
            default_profile: None,
            active_profile_id: None,
            profile_auto_switch: true,
        }
    }
}

impl AppSettings {
    pub fn normalize(&mut self) {
        let is_legacy_layout = self.settings_version == 0;
        if self.settings_version < 1 {
            if self.key_size == 68 {
                self.key_size = 100;
            }
            self.settings_version = 1;
        }

        if is_legacy_layout && self.layout_keys.is_empty() && !self.selected_keys.is_empty() {
            let migrated: Vec<String> = self
                .selected_keys
                .iter()
                .map(|key| legacy_key_to_code(key))
                .collect();
            self.layout_keys = layout_from_owned_codes(&migrated);
        }

        if self.settings_version < 2 {
            let global_size = self.key_size.clamp(36, 200) as f64;
            for key in &mut self.layout_keys {
                let width = key.width.map(f64::from).unwrap_or(global_size);
                let height = key.height.map(f64::from).unwrap_or(global_size);
                let old_horizontal_travel = (100.0 - width / 10.0).max(1.0);
                let old_vertical_travel = (100.0 - height / 4.0).max(1.0);
                key.x = (key.x / old_horizontal_travel * 100.0).clamp(0.0, 100.0);
                key.y = (key.y / old_vertical_travel * 100.0).clamp(0.0, 100.0);
            }
            self.kps_x = (self.kps_x / 88.0 * 100.0).clamp(0.0, 100.0);
            self.kps_y = (self.kps_y / 90.0 * 100.0).clamp(0.0, 100.0);
            self.settings_version = 2;
        }

        if self.settings_version < 6 && self.obs_key_color.eq_ignore_ascii_case("#FF00FF") {
            self.obs_key_color = default_obs_key_color();
        }

        if self.settings_version < 7 {
            if self.obs_key_color.eq_ignore_ascii_case("#11FF00") {
                self.obs_key_color = default_obs_key_color();
            }
            self.settings_version = 7;
        }
        if self.settings_version < 8 {
            self.settings_version = 8;
        }
        if self.settings_version < 9 {
            self.settings_version = 9;
        }
        let mut seen = HashSet::new();
        self.layout_keys.retain_mut(|key| {
            key.physical_code = legacy_key_to_code(&key.physical_code);
            if key.id.trim().is_empty() {
                key.id = format!("key-{}", key.physical_code);
            }
            if key.label.trim().is_empty() {
                key.label = display_label(&key.physical_code);
            }
            key.x = if key.x.is_finite() {
                key.x.clamp(0.0, 100.0)
            } else {
                0.0
            };
            key.y = if key.y.is_finite() {
                key.y.clamp(0.0, 100.0)
            } else {
                0.0
            };
            key.width = key.width.map(|width| width.clamp(28, 200));
            key.height = key.height.map(|height| height.clamp(28, 200));
            if let Some(appearance) = key.appearance.as_mut() {
                appearance.normalize();
            }
            seen.insert(key.physical_code.clone())
        });

        self.selected_keys = self
            .layout_keys
            .iter()
            .map(|key| key.physical_code.clone())
            .collect();
        self.key_size = self.key_size.clamp(36, 200);
        self.grid_size = self.grid_size.clamp(1, 20);
        self.kps_x = if self.kps_x.is_finite() {
            self.kps_x.clamp(0.0, 100.0)
        } else {
            default_kps_x()
        };
        self.kps_y = if self.kps_y.is_finite() {
            self.kps_y.clamp(0.0, 100.0)
        } else {
            default_kps_y()
        };
        self.accent = normalize_color(&self.accent, default_accent());
        self.key_background =
            normalize_color(&self.key_background, default_key_background().as_str());
        self.key_text = normalize_color(&self.key_text, default_key_text().as_str());
        self.key_border = normalize_color(&self.key_border, default_key_border().as_str());
        self.obs_key_color = normalize_color(&self.obs_key_color, default_obs_key_color().as_str());
        self.key_opacity = if self.key_opacity.is_finite() {
            self.key_opacity.clamp(0.35, 1.0)
        } else {
            default_key_opacity()
        };
        self.key_radius = self.key_radius.clamp(0, 24);
        self.key_border_width = self.key_border_width.clamp(0, 8);
        self.pressed_text = normalize_color(&self.pressed_text, default_pressed_text().as_str());
        self.pressed_border =
            normalize_color(&self.pressed_border, default_pressed_border().as_str());
        self.key_font_preset = normalize_font_preset(&self.key_font_preset);
        self.key_font_size = self.key_font_size.clamp(8, 64);
        self.key_font_weight = self.key_font_weight.clamp(400, 900);
        self.kps_font_preset = normalize_font_preset(&self.kps_font_preset);
        self.kps_value_size = self.kps_value_size.clamp(12, 120);
        self.kps_label_size = self.kps_label_size.clamp(7, 32);
        self.kps_font_weight = self.kps_font_weight.clamp(400, 900);
        self.press_depth = self.press_depth.clamp(0, 16);
        self.press_scale = self.press_scale.clamp(90, 105);
        self.press_animation_ms = self.press_animation_ms.clamp(0, 250);
        self.minimum_highlight_ms = self.minimum_highlight_ms.clamp(0, 250);

        if self.default_profile.is_none() {
            self.default_profile = Some(GameProfile::from_settings(
                self,
                DEFAULT_PROFILE_ID.to_string(),
                "Default layout".to_string(),
                String::new(),
            ));
        }
        if let Some(default_profile) = self.default_profile.as_mut() {
            default_profile.id = DEFAULT_PROFILE_ID.to_string();
            default_profile.name = "Default layout".to_string();
            default_profile.process_name.clear();
            default_profile.normalize();
        }

        let mut seen_profile_ids = HashSet::new();
        for profile in &mut self.profiles {
            profile.normalize();
        }
        self.profiles.retain(|profile| {
            !profile.id.trim().is_empty()
                && profile.id != DEFAULT_PROFILE_ID
                && seen_profile_ids.insert(profile.id.clone())
        });
        let active_profile_exists = self
            .active_profile_id
            .as_ref()
            .is_some_and(|id| self.profiles.iter().any(|profile| &profile.id == id));
        if self.active_profile_id.is_some() && !active_profile_exists {
            if let Some(default_profile) = self.default_profile.clone() {
                default_profile.apply_to_settings(self);
            }
            self.active_profile_id = None;
        }
        self.settings_version = 9;
    }

    pub fn apply_mutation(&mut self, mutation: SettingsMutation) -> Result<(), String> {
        match mutation {
            SettingsMutation::AddKey { mut key } => {
                if self
                    .layout_keys
                    .iter()
                    .any(|existing| existing.physical_code == key.physical_code)
                {
                    return Err("That physical key is already in the layout".to_string());
                }
                if key.id.trim().is_empty() {
                    key.id = format!("key-{}", key.physical_code);
                }
                self.layout_keys.push(key);
            }
            SettingsMutation::RemoveKey { id } => {
                self.layout_keys.retain(|key| key.id != id);
            }
            SettingsMutation::ClearKeys => {
                self.layout_keys.clear();
            }
            SettingsMutation::ResetKeys => {
                self.layout_keys = layout_from_codes(&DEFAULT_KEYS);
            }
            SettingsMutation::SetKeyLabel { id, label } => {
                let key = self
                    .layout_keys
                    .iter_mut()
                    .find(|key| key.id == id)
                    .ok_or_else(|| "Key not found".to_string())?;
                key.label = label;
            }
            SettingsMutation::SetKeySize { id, width, height } => {
                let key = self
                    .layout_keys
                    .iter_mut()
                    .find(|key| key.id == id)
                    .ok_or_else(|| "Key not found".to_string())?;
                key.width = Some(width);
                key.height = Some(height);
            }
            SettingsMutation::ClearKeySize { id } => {
                let key = self
                    .layout_keys
                    .iter_mut()
                    .find(|key| key.id == id)
                    .ok_or_else(|| "Key not found".to_string())?;
                key.width = None;
                key.height = None;
            }
            SettingsMutation::MoveKey { id, x, y } => {
                let key = self
                    .layout_keys
                    .iter_mut()
                    .find(|key| key.id == id)
                    .ok_or_else(|| "Key not found".to_string())?;
                key.x = x;
                key.y = y;
            }
            SettingsMutation::MoveKps { x, y } => {
                self.kps_x = x;
                self.kps_y = y;
            }
            SettingsMutation::SetLayoutOptions { patch } => {
                if let Some(value) = patch.key_size {
                    self.key_size = value;
                }
                if let Some(value) = patch.snap_to_grid {
                    self.snap_to_grid = value;
                }
                if let Some(value) = patch.grid_size {
                    self.grid_size = value;
                }
                if let Some(value) = patch.show_kps {
                    self.show_kps = value;
                }
            }
            SettingsMutation::SetGlobalAppearance { patch } => {
                apply_global_appearance_patch(self, patch);
            }
            SettingsMutation::ResetGlobalAppearance => {
                let defaults = AppSettings::default();
                copy_global_appearance(&defaults, self);
            }
            SettingsMutation::SetKeyAppearance { id, appearance } => {
                let key = self
                    .layout_keys
                    .iter_mut()
                    .find(|key| key.id == id)
                    .ok_or_else(|| "Key not found".to_string())?;
                key.appearance = appearance;
            }
            SettingsMutation::UpdateKeyAppearance { id, patch } => {
                let key = self
                    .layout_keys
                    .iter_mut()
                    .find(|key| key.id == id)
                    .ok_or_else(|| "Key not found".to_string())?;
                let appearance = key
                    .appearance
                    .as_mut()
                    .ok_or_else(|| "Custom key appearance is not enabled".to_string())?;
                apply_key_appearance_patch(appearance, patch);
            }
            SettingsMutation::ResetKeySettings { id } => {
                let key = self
                    .layout_keys
                    .iter_mut()
                    .find(|key| key.id == id)
                    .ok_or_else(|| "Key not found".to_string())?;
                key.label = display_label(&key.physical_code);
                key.width = None;
                key.height = None;
                key.appearance = None;
            }
            SettingsMutation::CreateProfile { name, process_name } => {
                self.sync_active_profile();
                let timestamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                let profile = GameProfile::from_settings(
                    self,
                    format!("profile-{timestamp}"),
                    name.unwrap_or_else(|| "New game".to_string()),
                    process_name.unwrap_or_default(),
                );
                let id = profile.id.clone();
                self.profiles.push(profile);
                self.active_profile_id = Some(id);
            }
            SettingsMutation::UpdateProfileDetails {
                id,
                name,
                process_name,
            } => {
                let profile = self
                    .profiles
                    .iter_mut()
                    .find(|profile| profile.id == id)
                    .ok_or_else(|| "Profile not found".to_string())?;
                if let Some(name) = name {
                    profile.name = name;
                }
                if let Some(process_name) = process_name {
                    profile.process_name = process_name;
                }
            }
            SettingsMutation::DeleteProfile { id } => {
                self.profiles.retain(|profile| profile.id != id);
            }
            SettingsMutation::ActivateProfile { id } => {
                if !self.activate_profile(&id) {
                    return Err("Profile not found".to_string());
                }
            }
            SettingsMutation::SetProfileAutoSwitch { enabled } => {
                self.profile_auto_switch = enabled;
            }
            SettingsMutation::SetOutputMode { mode } => {
                self.output_mode = mode;
            }
            SettingsMutation::SetObsColor { color } => {
                self.obs_key_color = color;
            }
            SettingsMutation::SetClickThrough { enabled } => {
                self.click_through = enabled;
            }
            SettingsMutation::SetTargetFilter {
                enabled,
                process_name,
            } => {
                self.show_when_target_active = enabled;
                self.target_process = process_name
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty());
            }
        }
        self.selected_keys = self
            .layout_keys
            .iter()
            .map(|key| key.physical_code.clone())
            .collect();
        Ok(())
    }

    pub fn sync_active_profile(&mut self) {
        let current = self.clone();
        if let Some(active_id) = self.active_profile_id.clone() {
            if let Some(profile) = self
                .profiles
                .iter_mut()
                .find(|profile| profile.id == active_id)
            {
                profile.update_from_settings(&current);
            }
        } else if let Some(default_profile) = self.default_profile.as_mut() {
            default_profile.update_from_settings(&current);
        }
    }

    pub fn activate_profile(&mut self, profile_id: &str) -> bool {
        self.sync_active_profile();
        let Some(profile) = self
            .profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned()
        else {
            return false;
        };
        profile.apply_to_settings(self);
        self.active_profile_id = Some(profile.id);
        true
    }

    #[cfg(test)]
    fn activate_default_profile(&mut self) -> bool {
        self.sync_active_profile();
        let Some(default_profile) = self.default_profile.clone() else {
            return false;
        };
        default_profile.apply_to_settings(self);
        self.active_profile_id = None;
        true
    }
}

fn apply_key_appearance_patch(appearance: &mut KeyAppearance, patch: AppearancePatch) {
    if let Some(value) = patch.accent {
        appearance.accent = value;
    }
    if let Some(value) = patch.key_background {
        appearance.key_background = value;
    }
    if let Some(value) = patch.key_text {
        appearance.key_text = value;
    }
    if let Some(value) = patch.key_border {
        appearance.key_border = value;
    }
    if let Some(value) = patch.key_opacity {
        appearance.key_opacity = value;
    }
    if let Some(value) = patch.key_radius {
        appearance.key_radius = value;
    }
    if let Some(value) = patch.key_border_width {
        appearance.key_border_width = value;
    }
    if let Some(value) = patch.pressed_text {
        appearance.pressed_text = value;
    }
    if let Some(value) = patch.pressed_border {
        appearance.pressed_border = value;
    }
    if let Some(value) = patch.key_font_preset {
        appearance.key_font_preset = value;
    }
    if let Some(value) = patch.key_font_size {
        appearance.key_font_size = value;
    }
    if let Some(value) = patch.key_font_weight {
        appearance.key_font_weight = value;
    }
    if let Some(value) = patch.press_depth {
        appearance.press_depth = value;
    }
    if let Some(value) = patch.press_scale {
        appearance.press_scale = value;
    }
    if let Some(value) = patch.press_animation_ms {
        appearance.press_animation_ms = value;
    }
    if let Some(value) = patch.minimum_highlight_ms {
        appearance.minimum_highlight_ms = value;
    }
}

fn apply_global_appearance_patch(settings: &mut AppSettings, patch: AppearancePatch) {
    if let Some(value) = patch.kps_font_preset.clone() {
        settings.kps_font_preset = value;
    }
    if let Some(value) = patch.kps_value_size {
        settings.kps_value_size = value;
    }
    if let Some(value) = patch.kps_label_size {
        settings.kps_label_size = value;
    }
    if let Some(value) = patch.kps_font_weight {
        settings.kps_font_weight = value;
    }
    let mut key_appearance = KeyAppearance {
        accent: settings.accent.clone(),
        key_background: settings.key_background.clone(),
        key_text: settings.key_text.clone(),
        key_border: settings.key_border.clone(),
        key_opacity: settings.key_opacity,
        key_radius: settings.key_radius,
        key_border_width: settings.key_border_width,
        pressed_text: settings.pressed_text.clone(),
        pressed_border: settings.pressed_border.clone(),
        key_font_preset: settings.key_font_preset.clone(),
        key_font_size: settings.key_font_size,
        key_font_weight: settings.key_font_weight,
        press_depth: settings.press_depth,
        press_scale: settings.press_scale,
        press_animation_ms: settings.press_animation_ms,
        minimum_highlight_ms: settings.minimum_highlight_ms,
    };
    apply_key_appearance_patch(&mut key_appearance, patch);
    settings.accent = key_appearance.accent;
    settings.key_background = key_appearance.key_background;
    settings.key_text = key_appearance.key_text;
    settings.key_border = key_appearance.key_border;
    settings.key_opacity = key_appearance.key_opacity;
    settings.key_radius = key_appearance.key_radius;
    settings.key_border_width = key_appearance.key_border_width;
    settings.pressed_text = key_appearance.pressed_text;
    settings.pressed_border = key_appearance.pressed_border;
    settings.key_font_preset = key_appearance.key_font_preset;
    settings.key_font_size = key_appearance.key_font_size;
    settings.key_font_weight = key_appearance.key_font_weight;
    settings.press_depth = key_appearance.press_depth;
    settings.press_scale = key_appearance.press_scale;
    settings.press_animation_ms = key_appearance.press_animation_ms;
    settings.minimum_highlight_ms = key_appearance.minimum_highlight_ms;
}

fn copy_global_appearance(source: &AppSettings, target: &mut AppSettings) {
    target.accent = source.accent.clone();
    target.key_background = source.key_background.clone();
    target.key_text = source.key_text.clone();
    target.key_border = source.key_border.clone();
    target.key_opacity = source.key_opacity;
    target.key_radius = source.key_radius;
    target.key_border_width = source.key_border_width;
    target.pressed_text = source.pressed_text.clone();
    target.pressed_border = source.pressed_border.clone();
    target.key_font_preset = source.key_font_preset.clone();
    target.key_font_size = source.key_font_size;
    target.key_font_weight = source.key_font_weight;
    target.kps_font_preset = source.kps_font_preset.clone();
    target.kps_value_size = source.kps_value_size;
    target.kps_label_size = source.kps_label_size;
    target.kps_font_weight = source.kps_font_weight;
    target.press_depth = source.press_depth;
    target.press_scale = source.press_scale;
    target.press_animation_ms = source.press_animation_ms;
    target.minimum_highlight_ms = source.minimum_highlight_ms;
}

fn default_snap_to_grid() -> bool {
    true
}

fn default_grid_size() -> u32 {
    4
}

fn default_kps_x() -> f64 {
    50.0
}

fn default_kps_y() -> f64 {
    90.0
}

fn default_profile_auto_switch() -> bool {
    true
}

fn default_accent() -> &'static str {
    "#D8FF5C"
}

fn default_key_background() -> String {
    "#20282D".to_string()
}

fn default_key_text() -> String {
    "#9BA7A8".to_string()
}

fn default_key_border() -> String {
    "#303B40".to_string()
}

fn default_key_opacity() -> f64 {
    0.92
}

fn default_key_radius() -> u32 {
    12
}

fn default_key_border_width() -> u32 {
    1
}

fn default_pressed_text() -> String {
    "#182015".to_string()
}

fn default_pressed_border() -> String {
    "#E8FF9A".to_string()
}

fn default_key_font_preset() -> String {
    "system".to_string()
}

fn default_key_font_size() -> u32 {
    14
}

fn default_key_font_weight() -> u32 {
    750
}

fn default_kps_font_preset() -> String {
    "system".to_string()
}

fn default_kps_value_size() -> u32 {
    24
}

fn default_kps_label_size() -> u32 {
    10
}

fn default_kps_font_weight() -> u32 {
    750
}

fn default_press_depth() -> u32 {
    4
}

fn default_press_scale() -> u32 {
    100
}

fn default_press_animation_ms() -> u32 {
    80
}

fn default_minimum_highlight_ms() -> u32 {
    0
}

fn default_obs_key_color() -> String {
    "#00FF00".to_string()
}

fn normalize_font_preset(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "compact" => "compact",
        "technical" => "technical",
        "classic" => "classic",
        _ => "system",
    }
    .to_string()
}

fn normalize_color(value: &str, fallback: &str) -> String {
    let value = value.trim();
    let valid_length = matches!(value.len(), 4 | 7);
    let valid_hex = value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit());
    if valid_length && valid_hex {
        value.to_ascii_uppercase()
    } else {
        fallback.to_string()
    }
}

fn layout_from_codes(codes: &[&str]) -> Vec<LayoutKey> {
    let owned: Vec<String> = codes.iter().map(|code| (*code).to_string()).collect();
    layout_from_owned_codes(&owned)
}

fn layout_from_owned_codes(codes: &[String]) -> Vec<LayoutKey> {
    let step = if codes.len() > 1 {
        100.0 / (codes.len() - 1) as f64
    } else {
        0.0
    };
    codes
        .iter()
        .enumerate()
        .map(|(index, code)| {
            let physical_code = legacy_key_to_code(code);
            LayoutKey {
                id: format!("key-{physical_code}"),
                label: display_label(&physical_code),
                physical_code,
                x: step * index as f64,
                y: 50.0,
                width: None,
                height: None,
                appearance: None,
            }
        })
        .collect()
}

fn legacy_key_to_code(key: &str) -> String {
    if key.len() == 1 {
        let character = key.chars().next().unwrap_or_default();
        if character.is_ascii_alphabetic() {
            return format!("Key{}", character.to_ascii_uppercase());
        }
        if character.is_ascii_digit() {
            return format!("Digit{character}");
        }
    }
    match key {
        ";" => "Semicolon",
        "-" => "Minus",
        "=" => "Equal",
        "[" => "BracketLeft",
        "]" => "BracketRight",
        "\\" => "Backslash",
        "'" => "Quote",
        "`" => "Backquote",
        "," => "Comma",
        "." => "Period",
        "/" => "Slash",
        value => value,
    }
    .to_string()
}

fn display_label(code: &str) -> String {
    if let Some(letter) = code.strip_prefix("Key") {
        return letter.to_string();
    }
    if let Some(digit) = code.strip_prefix("Digit") {
        return digit.to_string();
    }
    if let Some(number) = code.strip_prefix('F') {
        if number.chars().all(|character| character.is_ascii_digit()) {
            return code.to_string();
        }
    }
    match code {
        "Semicolon" => ";",
        "Minus" => "-",
        "Equal" => "=",
        "BracketLeft" => "[",
        "BracketRight" => "]",
        "Backslash" => "\\",
        "Quote" => "'",
        "Backquote" => "`",
        "Comma" => ",",
        "Period" => ".",
        "Slash" => "/",
        "Space" => "SPACE",
        "Escape" => "ESC",
        "Backspace" => "BACKSPACE",
        "CapsLock" => "CAPS",
        "ArrowLeft" => "LEFT",
        "ArrowRight" => "RIGHT",
        "ArrowUp" => "UP",
        "ArrowDown" => "DOWN",
        "ControlLeft" => "L CTRL",
        "ControlRight" => "R CTRL",
        "ShiftLeft" => "L SHIFT",
        "ShiftRight" => "R SHIFT",
        "AltLeft" => "L ALT",
        "AltRight" => "R ALT",
        "MetaLeft" => "L WIN",
        "MetaRight" => "R WIN",
        value => value,
    }
    .to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStateSnapshot {
    pub pressed_keys: Vec<String>,
    pub kps: u32,
    pub timestamp_ms: u64,
    pub capture_active: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPressPulse {
    pub physical_code: String,
    pub timestamp_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::{AppSettings, GameProfile, KeyAppearance, SettingsMutation};

    #[test]
    fn settings_mutations_deserialize_camel_case_variant_fields() {
        let create: SettingsMutation = serde_json::from_value(serde_json::json!({
            "type": "createProfile",
            "name": "Rhythm game",
            "processName": "rhythm.exe"
        }))
        .expect("create profile mutation should deserialize");
        let target: SettingsMutation = serde_json::from_value(serde_json::json!({
            "type": "setTargetFilter",
            "enabled": true,
            "processName": "rhythm.exe"
        }))
        .expect("target mutation should deserialize");

        assert!(matches!(
            create,
            SettingsMutation::CreateProfile {
                process_name: Some(ref process_name),
                ..
            } if process_name == "rhythm.exe"
        ));
        assert!(matches!(
            target,
            SettingsMutation::SetTargetFilter {
                enabled: true,
                process_name: Some(ref process_name),
            } if process_name == "rhythm.exe"
        ));
    }

    #[test]
    fn migrates_legacy_selected_keys_into_a_positioned_layout() {
        let mut settings = AppSettings {
            settings_version: 0,
            selected_keys: vec!["A".to_string(), ";".to_string()],
            layout_keys: Vec::new(),
            ..AppSettings::default()
        };

        settings.normalize();

        assert_eq!(settings.layout_keys.len(), 2);
        assert_eq!(settings.layout_keys[0].physical_code, "KeyA");
        assert_eq!(settings.layout_keys[1].physical_code, "Semicolon");
        assert_eq!(settings.selected_keys, vec!["KeyA", "Semicolon"]);
    }

    #[test]
    fn current_empty_layouts_are_not_rebuilt_from_stale_selected_keys() {
        let mut settings = AppSettings {
            selected_keys: vec!["KeyA".to_string(), "KeyS".to_string()],
            layout_keys: Vec::new(),
            ..AppSettings::default()
        };

        settings.normalize();

        assert!(settings.layout_keys.is_empty());
        assert!(settings.selected_keys.is_empty());
    }

    #[test]
    fn removes_duplicate_physical_keys_from_a_layout() {
        let mut settings = AppSettings::default();
        settings.layout_keys.push(settings.layout_keys[0].clone());

        settings.normalize();

        assert_eq!(settings.layout_keys.len(), settings.selected_keys.len());
        assert_eq!(
            settings
                .selected_keys
                .iter()
                .filter(|code| code.as_str() == "KeyA")
                .count(),
            1
        );
    }

    #[test]
    fn clearing_keys_stays_empty_after_normalization() {
        let mut settings = AppSettings::default();
        settings.normalize();

        settings
            .apply_mutation(SettingsMutation::ClearKeys)
            .expect("clearing keys should succeed");
        settings.normalize();

        assert!(settings.layout_keys.is_empty());
        assert!(settings.selected_keys.is_empty());
    }

    #[test]
    fn removing_the_last_key_stays_empty_after_normalization() {
        let mut settings = AppSettings::default();
        settings.normalize();
        settings.layout_keys.truncate(1);
        settings.selected_keys = settings
            .layout_keys
            .iter()
            .map(|key| key.physical_code.clone())
            .collect();
        let last_key_id = settings.layout_keys[0].id.clone();

        settings
            .apply_mutation(SettingsMutation::RemoveKey { id: last_key_id })
            .expect("removing the last key should succeed");
        settings.normalize();

        assert!(settings.layout_keys.is_empty());
        assert!(settings.selected_keys.is_empty());
    }

    #[test]
    fn migrates_the_previous_default_key_size_without_overwriting_custom_sizes() {
        let mut previous_default = AppSettings {
            settings_version: 0,
            key_size: 68,
            ..AppSettings::default()
        };
        previous_default.normalize();
        assert_eq!(previous_default.key_size, 100);

        let mut custom_size = AppSettings {
            settings_version: 0,
            key_size: 84,
            ..AppSettings::default()
        };
        custom_size.normalize();
        assert_eq!(custom_size.key_size, 84);
    }

    #[test]
    fn migrates_canvas_percentages_to_edge_to_edge_travel() {
        let mut settings = AppSettings {
            settings_version: 1,
            key_size: 100,
            kps_x: 44.0,
            kps_y: 84.0,
            ..AppSettings::default()
        };
        settings.layout_keys[0].x = 45.0;
        settings.layout_keys[0].y = 37.5;

        settings.normalize();

        assert_eq!(settings.settings_version, 9);
        assert!((settings.layout_keys[0].x - 50.0).abs() < 0.001);
        assert!((settings.layout_keys[0].y - 50.0).abs() < 0.001);
        assert!((settings.kps_x - 50.0).abs() < 0.001);
        assert!((settings.kps_y - 93.333_333).abs() < 0.001);
    }

    #[test]
    fn activates_a_game_profile_and_syncs_changes_back_to_it() {
        let mut settings = AppSettings::default();
        settings.normalize();
        let mut profile = GameProfile::from_settings(
            &settings,
            "profile-osu".to_string(),
            "osu!".to_string(),
            "osu!.exe".to_string(),
        );
        profile.key_size = 150;
        settings.profiles.push(profile);

        assert!(settings.activate_profile("profile-osu"));
        assert_eq!(settings.key_size, 150);
        settings.accent = "#ffffff".to_string();
        settings.sync_active_profile();

        assert_eq!(settings.profiles[0].accent, "#ffffff");
        assert!(!settings.activate_profile("missing"));
    }

    #[test]
    fn keeps_an_internal_default_layout_without_exposing_a_game_profile() {
        let mut settings = AppSettings::default();
        settings.normalize();

        assert!(settings.profiles.is_empty());
        let default_profile = settings
            .default_profile
            .as_ref()
            .expect("normalization should create the internal default layout");
        assert_eq!(default_profile.id, "__kps_default__");
        assert_eq!(
            default_profile.layout_keys.len(),
            settings.layout_keys.len()
        );
        assert_eq!(
            default_profile.layout_keys[0].physical_code,
            settings.layout_keys[0].physical_code
        );

        settings.layout_keys[0].x = 73.0;
        settings.accent = "#123456".to_string();
        settings.sync_active_profile();

        let saved_default = settings.default_profile.as_ref().unwrap();
        assert_eq!(saved_default.layout_keys[0].x, 73.0);
        assert_eq!(saved_default.accent, "#123456");
    }

    #[test]
    fn preserves_and_restores_the_default_layout_across_game_profiles() {
        let mut settings = AppSettings::default();
        settings.normalize();
        settings.accent = "#123456".to_string();
        settings.layout_keys[0].x = 73.0;
        settings.sync_active_profile();

        let mut profile = GameProfile::from_settings(
            &settings,
            "profile-osu".to_string(),
            "osu!".to_string(),
            "osu!.exe".to_string(),
        );
        profile.accent = "#abcdef".to_string();
        profile.layout_keys[0].x = 18.0;
        settings.profiles.push(profile);

        assert!(settings.activate_profile("profile-osu"));
        assert_eq!(settings.accent, "#abcdef");
        assert_eq!(settings.layout_keys[0].x, 18.0);
        assert!(settings.activate_default_profile());
        assert_eq!(settings.accent, "#123456");
        assert_eq!(settings.layout_keys[0].x, 73.0);

        assert!(settings.activate_profile("profile-osu"));
        settings.profiles.clear();
        settings.normalize();
        assert!(settings.active_profile_id.is_none());
        assert_eq!(settings.accent, "#123456");
        assert_eq!(settings.layout_keys[0].x, 73.0);
    }

    #[test]
    fn supplies_and_normalizes_the_global_obs_key_color_for_legacy_settings() {
        let mut legacy = serde_json::to_value(AppSettings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("obsKeyColor");
        let mut settings: AppSettings = serde_json::from_value(legacy).unwrap();

        settings.normalize();
        assert_eq!(settings.obs_key_color, "#00FF00");

        settings.obs_key_color = "#ab12ef".to_string();
        settings.normalize();
        assert_eq!(settings.obs_key_color, "#AB12EF");
    }

    #[test]
    fn migrates_the_previous_default_obs_color_to_chroma_green() {
        let mut legacy = AppSettings {
            settings_version: 5,
            obs_key_color: "#FF00FF".to_string(),
            ..AppSettings::default()
        };

        legacy.normalize();

        assert_eq!(legacy.obs_key_color, "#00FF00");
        assert_eq!(legacy.settings_version, 9);

        let mut custom = AppSettings {
            settings_version: 5,
            obs_key_color: "#AB12EF".to_string(),
            ..AppSettings::default()
        };
        custom.normalize();

        assert_eq!(custom.obs_key_color, "#AB12EF");
        assert_eq!(custom.settings_version, 9);
    }

    #[test]
    fn restores_the_temporary_lime_obs_color_to_pure_green() {
        let mut settings = AppSettings {
            settings_version: 6,
            obs_key_color: "#11FF00".to_string(),
            ..AppSettings::default()
        };

        settings.normalize();

        assert_eq!(settings.obs_key_color, "#00FF00");
        assert_eq!(settings.settings_version, 9);

        let mut custom = AppSettings {
            settings_version: 7,
            obs_key_color: "#11FF00".to_string(),
            ..AppSettings::default()
        };

        custom.normalize();

        assert_eq!(custom.obs_key_color, "#11FF00");
    }

    #[test]
    fn migrates_typography_and_press_feedback_without_changing_old_behavior() {
        let mut legacy = serde_json::to_value(AppSettings::default()).unwrap();
        let object = legacy.as_object_mut().unwrap();
        for field in [
            "keyFontPreset",
            "keyFontSize",
            "keyFontWeight",
            "kpsFontPreset",
            "kpsValueSize",
            "kpsLabelSize",
            "kpsFontWeight",
            "keyBorderWidth",
            "pressedText",
            "pressedBorder",
            "pressDepth",
            "pressScale",
            "pressAnimationMs",
            "minimumHighlightMs",
        ] {
            object.remove(field);
        }
        let mut settings: AppSettings = serde_json::from_value(legacy).unwrap();

        settings.normalize();

        assert_eq!(settings.key_font_preset, "system");
        assert_eq!(settings.key_font_size, 14);
        assert_eq!(settings.kps_value_size, 24);
        assert_eq!(settings.press_depth, 4);
        assert_eq!(settings.press_scale, 100);
        assert_eq!(settings.press_animation_ms, 80);
        assert_eq!(settings.minimum_highlight_ms, 0);
        assert_eq!(settings.settings_version, 9);
    }

    #[test]
    fn keeps_legacy_keys_global_and_normalizes_custom_key_appearance() {
        let mut legacy = serde_json::to_value(AppSettings::default()).unwrap();
        for key in legacy["layoutKeys"].as_array_mut().unwrap() {
            key.as_object_mut().unwrap().remove("appearance");
        }
        let mut legacy_settings: AppSettings = serde_json::from_value(legacy).unwrap();
        legacy_settings.normalize();

        assert!(legacy_settings
            .layout_keys
            .iter()
            .all(|key| key.appearance.is_none()));
        assert_eq!(legacy_settings.settings_version, 9);

        let mut settings = AppSettings::default();
        settings.layout_keys[0].appearance = Some(KeyAppearance {
            accent: "invalid".to_string(),
            key_opacity: 4.0,
            key_radius: 100,
            key_font_preset: "unknown".to_string(),
            key_font_size: 2,
            key_font_weight: 1200,
            press_depth: 90,
            press_scale: 20,
            press_animation_ms: 900,
            minimum_highlight_ms: 900,
            ..KeyAppearance::default()
        });
        settings.normalize();

        let appearance = settings.layout_keys[0].appearance.as_ref().unwrap();
        assert_eq!(appearance.accent, "#D8FF5C");
        assert_eq!(appearance.key_opacity, 1.0);
        assert_eq!(appearance.key_radius, 24);
        assert_eq!(appearance.key_font_preset, "system");
        assert_eq!(appearance.key_font_size, 8);
        assert_eq!(appearance.key_font_weight, 900);
        assert_eq!(appearance.press_depth, 16);
        assert_eq!(appearance.press_scale, 90);
        assert_eq!(appearance.press_animation_ms, 250);
        assert_eq!(appearance.minimum_highlight_ms, 250);
    }
}
