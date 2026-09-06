/**
 * BrowserDJ AI — Internationalization Module (i18n)
 * Provides comprehensive translations for English (EN), Spanish (ES), and Portuguese (PT).
 */

export const TRANSLATIONS = {
    es: {
        brand_model: "ANALOG PRECISION // AP-808",
        unit_serial: "SERIE V.01-UNIT // SAMPLER HI-FI DSP",
        locale_label: "IDIOMA // LOCALE",
        telemetry_power: "ALIMENTACIÓN / GPU",
        telemetry_audio: "MOTOR DE AUDIO",
        telemetry_workload: "CARGA DSP",
        status_gpu_loading: "WebGPU: Cargando...",
        status_gpu_ready: "WebGPU: Gemma 4 Lista (Local)",
        status_gpu_offline: "WebGPU: No disponible",
        status_audio_init: "Audio: Inicializando...",
        status_audio_online: "Audio: 48kHz Online",
        status_audio_inactive: "Audio: Inactivo",
        status_audio_error: "Audio: Error",
        transport_pause: "PAUSA",
        transport_resume: "REANUDAR",
        transport_samples: "SAMPLES",
        transport_rec: "REC MIX",
        transport_rec_stop: "DETENER",
        mod1_title: "UNIDAD OSCILOSCOPIO Y SECUENCIADOR",
        crt_sweep: "BARRIDO: 44.1 kHz",
        crt_mode: "OSC VECTORIAL",
        crt_mon: "CANAL-1 MON",
        seq_clock_title: "RELOJ MAESTRO DE 16 PASOS",
        seq_division: "DIVISIÓN 1/16 DE NOTA",
        mute_strip_label: "MUTE // SOLO DE CANALES:",
        mute_kick: "KICK / BOMBO",
        mute_hats: "HATS / PLATILLO",
        mute_synth: "SYNTH / LEAD",
        mod2_title: "MEZCLADOR MAESTRO Y FILTROS ANALÓGICOS",
        fader_vol: "VOLUMEN",
        fader_cutoff: "CORTE",
        fader_reverb: "REVERB",
        fader_delay: "DELAY",
        fader_length: "COMPÁS",
        step_unit: "Pasos",
        mod_metrics_title: "MONITOR DE PARÁMETROS",
        meter_scale: "ESCALA / TONALIDAD",
        meter_tempo: "TEMPO (BPM)",
        meter_synth: "ONDA SINTETIZADOR",
        meter_drums: "KIT PERCUSIÓN",
        meter_effects: "ESPACIO FX",
        meter_morph: "PROGRESO DE TRANSICIÓN",
        mod_ai_title: "CENTRO DE COMANDOS IA // GEMMA 4 LOCAL",
        preset_banks_label: "BANCOS DE PRESETS:",
        prompt_placeholder: "Ingresa comando en lenguaje natural (ej. 'techno a 135 bpm con onda cuadrada')...",
        btn_execute: "EJECUTAR",
        btn_translating: "Traduciendo...",
        log_header: "REGISTRO Y CINTA DE AUDITORÍA:",
        log_init_prompt: "SYS_INIT // BOOT_OK",
        log_init_result: "✓ Patrón predeterminado cargado a 120 BPM",
        scale_minor: "menor",
        scale_major: "mayor",
        wave_saw: "Sierra",
        wave_square: "Cuadrada",
        wave_cycle: "Senoidal",
        drums_both: "Bombo + Platillo",
        drums_kick_only: "Solo Bombo",
        drums_hats_only: "Solo Platillo",
        drums_muted: "Sin Percusión",
        morphing_label: "Morfosis",
        mapping_to: "Mapeando a",
        presets: [
            { id: "01", label: "01: TECHNO 135", prompt: "ritmo techno oscuro a 135 bpm con onda cuadrada y mucho reverb" },
            { id: "02", label: "02: DEEP HOUSE", prompt: "house melódico y bailable a 124 bpm con swing" },
            { id: "03", label: "03: SYNTHWAVE", prompt: "synthwave retro 80s con onda de sierra y delay al 50%" },
            { id: "04", label: "04: LO-FI CHILL", prompt: "ritmo lo-fi chill relajante a 85 bpm con filtro cálido" },
            { id: "05", label: "05: REGGAETÓN", prompt: "ritmo de reggaeton dembow bailable a 96 bpm" },
            { id: "06", label: "06: ACID 303", prompt: "línea de bajo acid techno 303 a 136 bpm con resonancia y onda cuadrada" },
            { id: "07", label: "07: BUILD & DROP", prompt: "haz un drop épico con redoble y explosión en 32 pasos" },
            { id: "08", label: "08: SOLO SYNTH", prompt: "quita la batería y deja solo el sintetizador" }
        ]
    },
    en: {
        brand_model: "ANALOG PRECISION // AP-808",
        unit_serial: "SERIES V.01-UNIT // HI-FI DSP SAMPLER",
        locale_label: "LOCALE // LANG SELECT",
        telemetry_power: "POWER / GPU",
        telemetry_audio: "AUDIO ENGINE",
        telemetry_workload: "WORKLOAD",
        status_gpu_loading: "WebGPU: Loading Model...",
        status_gpu_ready: "WebGPU: Gemma 4 Ready (Local)",
        status_gpu_offline: "WebGPU: Offline",
        status_audio_init: "Audio: Initializing...",
        status_audio_online: "Audio: 48kHz Online",
        status_audio_inactive: "Audio: Inactive",
        status_audio_error: "Audio: Error",
        transport_pause: "PAUSE",
        transport_resume: "RESUME",
        transport_samples: "SAMPLES",
        transport_rec: "REC MIX",
        transport_rec_stop: "STOP REC",
        mod1_title: "OSCILLOSCOPE & STEP SEQUENCER UNIT",
        crt_sweep: "SWEEP: 44.1 kHz",
        crt_mode: "VECTOR OSC",
        crt_mon: "CH-1 MON",
        seq_clock_title: "16-STEP MASTER RHYTHM CLOCK",
        seq_division: "1/16 NOTE DIVISION",
        mute_strip_label: "CHANNEL MUTE // SOLO:",
        mute_kick: "KICK / BASS DRUM",
        mute_hats: "HATS / CYMBAL",
        mute_synth: "SYNTH / LEAD",
        mod2_title: "MASTER MIXER & ANALOG FILTERS",
        fader_vol: "VOLUME",
        fader_cutoff: "CUTOFF",
        fader_reverb: "REVERB",
        fader_delay: "DELAY",
        fader_length: "LENGTH",
        step_unit: "Steps",
        mod_metrics_title: "PARAMETERS MONITOR",
        meter_scale: "SCALE / KEY",
        meter_tempo: "TEMPO (BPM)",
        meter_synth: "SYNTH WAVE",
        meter_drums: "DRUM KIT",
        meter_effects: "DSP SPATIAL FX",
        meter_morph: "MORPHING TRANSITION PROGRESS",
        mod_ai_title: "AI COMMAND DECK // LOCAL GEMMA 4",
        preset_banks_label: "PRESET BANKS:",
        prompt_placeholder: "Enter musical prompt in natural language (e.g. 'dark techno at 135 bpm with square wave')...",
        btn_execute: "EXECUTE",
        btn_translating: "Translating...",
        log_header: "SYSTEM LOG & AUDIT TAPE:",
        log_init_prompt: "SYS_INIT // BOOT_OK",
        log_init_result: "✓ Default groove loaded at 120 BPM",
        scale_minor: "minor",
        scale_major: "major",
        wave_saw: "Saw",
        wave_square: "Square",
        wave_cycle: "Sine",
        drums_both: "Kick + Cymbal",
        drums_kick_only: "Kick Only",
        drums_hats_only: "Cymbal Only",
        drums_muted: "Muted Drums",
        morphing_label: "Morphing",
        mapping_to: "Mapping to",
        presets: [
            { id: "01", label: "01: DARK TECHNO 135", prompt: "dark techno beat at 135 bpm with square wave and heavy reverb" },
            { id: "02", label: "02: DEEP HOUSE", prompt: "melodic groovy house beat at 124 bpm with swing" },
            { id: "03", label: "03: RETRO SYNTHWAVE", prompt: "retro 80s synthwave with saw wave and 50% delay" },
            { id: "04", label: "04: LO-FI CHILL", prompt: "relaxing lo-fi chill hop beat at 85 bpm with warm filter" },
            { id: "05", label: "05: REGGAETON", prompt: "danceable reggaeton dembow rhythm at 96 bpm" },
            { id: "06", label: "06: ACID 303", prompt: "acid techno 303 bassline at 136 bpm with resonance and square wave" },
            { id: "07", label: "07: BUILD & DROP", prompt: "make an epic drop with drum roll and climax in 32 steps" },
            { id: "08", label: "08: DRUMS ONLY", prompt: "mute the synth and keep only the drums" }
        ]
    },
    pt: {
        brand_model: "ANALOG PRECISION // AP-808",
        unit_serial: "SÉRIE V.01-UNIT // SAMPLER HI-FI DSP",
        locale_label: "IDIOMA // LOCALE",
        telemetry_power: "ENERGIA / GPU",
        telemetry_audio: "MOTOR DE ÁUDIO",
        telemetry_workload: "CARGA DSP",
        status_gpu_loading: "WebGPU: Carregando Modelo...",
        status_gpu_ready: "WebGPU: Gemma 4 Pronta (Local)",
        status_gpu_offline: "WebGPU: Offline",
        status_audio_init: "Áudio: Inicializando...",
        status_audio_online: "Áudio: 48kHz Online",
        status_audio_inactive: "Áudio: Inativo",
        status_audio_error: "Áudio: Erro",
        transport_pause: "PAUSAR",
        transport_resume: "RETOMAR",
        transport_samples: "AMOSTRAS",
        transport_rec: "GRAVAR",
        transport_rec_stop: "PARAR",
        mod1_title: "UNIDADE DE OSCILOSCÓPIO E SEQUENCIADOR",
        crt_sweep: "VARREDURA: 44.1 kHz",
        crt_mode: "OSC VETORIAL",
        crt_mon: "CANAL-1 MON",
        seq_clock_title: "CLOCK RÍTMICO DE 16 PASSOS",
        seq_division: "DIVISÃO 1/16 DE NOTA",
        mute_strip_label: "MUTE // SOLO DE CANAIS:",
        mute_kick: "BUMBO / KICK",
        mute_hats: "CHIMBAL / HATS",
        mute_synth: "SINTETIZADOR / LEAD",
        mod2_title: "MIXER PRINCIPAL E FILTROS ANALÓGICOS",
        fader_vol: "VOLUME",
        fader_cutoff: "CORTE",
        fader_reverb: "REVERB",
        fader_delay: "DELAY",
        fader_length: "COMPASSO",
        step_unit: "Passos",
        mod_metrics_title: "MONITOR DE PARÂMETROS",
        meter_scale: "ESCALA / TOM",
        meter_tempo: "TEMPO (BPM)",
        meter_synth: "ONDA SINTETIZADOR",
        meter_drums: "BATERIA",
        meter_effects: "ESPAÇO FX",
        meter_morph: "PROGRESSO DA TRANSIÇÃO",
        mod_ai_title: "CENTRAL DE COMANDOS IA // GEMMA 4 LOCAL",
        preset_banks_label: "BANCOS DE PRESETS:",
        prompt_placeholder: "Digite comando em linguagem natural (ex: 'techno a 135 bpm com onda quadrada')...",
        btn_execute: "EXECUTAR",
        btn_translating: "Traduzindo...",
        log_header: "REGISTRO E FITA DE AUDITORIA:",
        log_init_prompt: "SYS_INIT // BOOT_OK",
        log_init_result: "✓ Padrão padrão carregado a 120 BPM",
        scale_minor: "menor",
        scale_major: "maior",
        wave_saw: "Dente de serra",
        wave_square: "Quadrada",
        wave_cycle: "Senoidal",
        drums_both: "Bumbo + Chimbal",
        drums_kick_only: "Só Bumbo",
        drums_hats_only: "Só Chimbal",
        drums_muted: "Sem Bateria",
        morphing_label: "Morfose",
        mapping_to: "Mapeando para",
        presets: [
            { id: "01", label: "01: TECHNO 135", prompt: "ritmo techno escuro a 135 bpm com onda quadrada e muito reverb" },
            { id: "02", label: "02: DEEP HOUSE", prompt: "house melódico e dançante a 124 bpm com swing" },
            { id: "03", label: "03: SYNTHWAVE", prompt: "synthwave retrô anos 80 com dente de serra e delay em 50%" },
            { id: "04", label: "04: LO-FI RELAX", prompt: "ritmo lo-fi chill relaxante a 85 bpm com filtro quente" },
            { id: "05", label: "05: REGGAETON", prompt: "ritmo de reggaeton dembow dançante a 96 bpm" },
            { id: "06", label: "06: ACID 303", prompt: "linha de baixo acid techno 303 a 136 bpm com ressonância e onda quadrada" },
            { id: "07", label: "07: VIRADA & DROP", prompt: "faça um drop épico com virada de bateria e explosão em 32 passos" },
            { id: "08", label: "08: SÓ SYNTH", prompt: "tire a bateria e deixe apenas o sintetizador" }
        ]
    }
};

/**
 * Returns translated string for key and target language.
 */
export function t(key, lang = 'es') {
    const locale = TRANSLATIONS[lang] || TRANSLATIONS.es;
    return locale[key] || TRANSLATIONS.es[key] || key;
}

/**
 * Applies all static data-i18n translations to DOM elements.
 */
export function applyI18n(lang = 'es') {
    const locale = TRANSLATIONS[lang] || TRANSLATIONS.es;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (locale[key]) {
            el.innerText = locale[key];
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        if (locale[key]) {
            el.placeholder = locale[key];
        }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        if (locale[key]) {
            el.title = locale[key];
        }
    });
}
