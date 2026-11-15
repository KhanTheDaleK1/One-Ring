mod state;

use state::{AppStateSnapshot, ManagedState};
use tauri::State;

#[tauri::command]
fn get_app_state(state: State<ManagedState>) -> AppStateSnapshot {
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn trigger_cue(cue_index: usize, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    if cue_index >= inner.cues.len() {
        return inner.clone();
    }
    *state.undo_snapshot.lock().unwrap() = Some(inner.clone());

    let cue = inner.cues[cue_index].clone();
    inner.active_cue_index = cue_index;
    inner.obs_scene = cue.obs_scene;
    inner.active_camera_preset_id = cue.camera_preset_id;
    inner.slides.presentation_name = cue.slide_label;
    inner.slides.current_slide = 1;
    inner.slides.cleared = false;
    inner.can_undo = true;

    for dca in &mut inner.dcas {
        if cue.unmute_dcas.iter().any(|id| id == &dca.id) {
            dca.muted = false;
        }
        if cue.mute_dcas.iter().any(|id| id == &dca.id) {
            dca.muted = true;
        }
    }

    inner.clone()
}

#[tauri::command]
fn undo_last_cue(state: State<ManagedState>) -> AppStateSnapshot {
    let prev = state.undo_snapshot.lock().unwrap().take();
    if let Some(mut restored) = prev {
        restored.can_undo = false;
        let mut inner = state.inner.lock().unwrap();
        *inner = restored;
        return inner.clone();
    }
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn toggle_dca_mute(dca_id: String, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    if let Some(dca) = inner.dcas.iter_mut().find(|d| d.id == dca_id) {
        dca.muted = !dca.muted;
    }
    inner.clone()
}

#[tauri::command]
fn nudge_dca_level(dca_id: String, delta_db: f32, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    if let Some(dca) = inner.dcas.iter_mut().find(|d| d.id == dca_id) {
        dca.level_db = (dca.level_db + delta_db).clamp(dca.min_db, dca.max_db);
    }
    inner.clone()
}

#[tauri::command]
fn recall_camera_preset(preset_id: String, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    inner.active_camera_preset_id = preset_id;
    inner.clone()
}

#[tauri::command]
fn trigger_slide_action(action: String, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    match action.as_str() {
        "next" => {
            inner.slides.cleared = false;
            if inner.slides.current_slide < inner.slides.total_slides {
                inner.slides.current_slide += 1;
            }
        }
        "prev" => {
            inner.slides.cleared = false;
            if inner.slides.current_slide > 1 {
                inner.slides.current_slide -= 1;
            }
        }
        "clear" => {
            inner.slides.cleared = !inner.slides.cleared;
        }
        _ => {}
    }
    inner.clone()
}

#[tauri::command]
fn set_broadcast_state(target_id: String, live: bool, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    for b in &mut inner.broadcasts {
        if target_id == "all" || b.id == target_id {
            b.live = live;
            b.bitrate_kbps = if live { 5800 } else { 0 };
        }
    }
    inner.clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ManagedState::default())
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            trigger_cue,
            undo_last_cue,
            toggle_dca_mute,
            nudge_dca_level,
            recall_camera_preset,
            trigger_slide_action,
            set_broadcast_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running One Ring");
}
