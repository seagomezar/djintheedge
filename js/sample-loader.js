/**
 * Local Sample Loader.
 * Uses the File System Access API (showDirectoryPicker) to load a folder
 * of audio files from the client device, decodes them, and registers them
 * with the AudioEngine.
 */

export class SampleLoader {
    /**
     * Triggers directory picker, reads WAV/MP3 files, decodes buffers, and loads them into AudioEngine.
     * @param {AudioEngine} audioEngine - The instantiated AudioEngine to register samples in.
     */
    static async loadSamplesFromDirectory(audioEngine) {
        try {
            // Ensure AudioContext is resumed before decoding
            if (audioEngine.ctx.state === 'suspended') {
                await audioEngine.ctx.resume();
            }

            const dirHandle = await window.showDirectoryPicker();
            let loadedCount = 0;

            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && (entry.name.endsWith('.wav') || entry.name.endsWith('.mp3'))) {
                    const file = await entry.getFile();
                    const arrayBuffer = await file.arrayBuffer();
                    
                    try {
                        const audioBuffer = await audioEngine.ctx.decodeAudioData(arrayBuffer);
                        const normalizedName = entry.name.replace(/\.[^/.]+$/, "");
                        
                        audioEngine.registerSample(normalizedName, audioBuffer);
                        loadedCount++;
                    } catch (decodeErr) {
                        console.error(`Error decoding file "${entry.name}":`, decodeErr);
                    }
                }
            }

            if (loadedCount > 0) {
                alert(`Sincronización exitosa: ${loadedCount} sample(s) cargado(s) al motor de audio.`);
            } else {
                alert("No se encontraron archivos .wav o .mp3 en la carpeta seleccionada.");
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error("Error leyendo directorio local de samples:", err);
                alert("Error al acceder al directorio de samples: " + err.message);
            }
        }
    }
}
