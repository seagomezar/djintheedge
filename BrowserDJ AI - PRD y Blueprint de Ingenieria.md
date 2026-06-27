# **BrowserDJ AI: Documento de Requerimientos de Producto (PRD) y Blueprint de Ingeniería**

**Autor:** Sistema de Arquitectura Autónoma  
**Descripción:** Especificación técnica detallada y blueprint de código fuente para un compositor y entorno de DJ basado 100% en el navegador, operando completamente offline (On-Device) utilizando el modelo Gemma 4 mediante LiteRT-LM y síntesis procedimental con el framework Elementary Audio.

## **1\. Resumen Ejecutivo**

BrowserDJ AI es un ecosistema de ejecución musical en el cliente (client-side only). Su propósito es otorgar capacidades de composición en tiempo real mediante el procesamiento de comandos en lenguaje natural sin delegar cómputo a servidores remotos. Al eliminar por completo la dependencia de una conexión de red, se garantiza la privacidad absoluta de la sesión de performance, la eliminación de la latencia de transporte de datos y una resiliencia total frente a fallos de conectividad.

## **2\. Objetivos del Sistema**

* **Inferencia Local de Alto Rendimiento:** Orquestar el modelo Gemma 4 optimizado empleando la API nativa de WebGPU para lograr ejecuciones de tokens de baja latencia directamente en el hardware de gráficos integrado o dedicado del usuario.  
* **Síntesis Matemática Ininterrumpida:** Compilar estructuras algorítmicas de audio dinámicamente sin generar clics analógicos, caídas de fase o interrupciones en el flujo sonoro continuo.  
* **Control de Cómputo Híbrido:** Unificar el paradigma de síntesis procedimental por ecuaciones con la reproducción de muestras de audio almacenadas físicamente en el dispositivo del usuario mediante abstracciones semánticas manejadas por el Modelo de Lenguaje.

## **3\. Modelo de Hilos y Concurrencia (Threading Model)**

Para asegurar que la generación de flujos de audio a 44.1kHz permanezca inmune a la carga computacional demandada por el LLM, la arquitectura se divide estrictamente en tres entornos de ejecución paralela independientes:

1. **Hilo Principal (Main UI Thread):** Responsable exclusivo del ciclo de vida del DOM, control de sliders físicos, renderizado del analizador de espectro mediante el elemento Canvas y llamadas a las APIs del navegador (tales como File System Access API y MediaRecorder API). Ninguna operación síncrona de cálculo matemático pesado se ejecuta en este hilo.  
2. **Contexto WebGPU y Proceso de Inferencia:** El motor LiteRT-LM asigna tensores directamente a los hilos de sombreado de la GPU. La comunicación se realiza asíncronamente mediante promesas nativas de JavaScript, evitando por completo el bloqueo de la interfaz de usuario durante la inferencia de tokens.  
3. **Hilo del AudioWorklet (Tiempo Real):** Un hilo aislado del sistema operativo dedicado al procesamiento digital de señales. El WebRenderer de Elementary Audio compila y ejecuta el árbol virtual de nodos DSP de manera síncrona dentro de este entorno, aislando el sonido de cualquier fluctuación de rendimiento en la CPU o la GPU.

## **4\. Requerimientos Funcionales Detallados**

### **4.1 Módulo de Modelado de Lenguaje Local (LiteRT-LM)**

El motor debe gestionar de forma óptima el ciclo de vida de los pesos binarios de Gemma 4\. En la sesión inicial, se descarga el archivo binario empaquetado para la web y se transmite por fragmentos directamente hacia el Origin Private File System (OPFS), impidiendo fugas de memoria RAM. Las ejecuciones posteriores recuperan el modelo de manera instantánea y local desde el OPFS. El motor aplica decodificación restringida mediante directivas del sistema, inhabilitando respuestas conversacionales de texto plano y obligando al LLM a emitir únicamente código estructurado bajo un esquema JSON determinista.

### **4.2 Motor de Audio (Elementary Audio)**

El entorno musical utiliza una capa funcional declarativa para reconfigurar el flujo del procesamiento digital. El sistema cuenta con sintetizadores sustractivos polifónicos integrados basados en osciladores de onda senoidal, de sierra y generadores de ruido. La temporización depende críticamente de un oscilador de control maestro de baja frecuencia sincronizado con los Beats Por Minuto (BPM) deducidos por el modelo de IA. Toda actualización en el árbol virtual es reconciliada dinámicamente sin mutar directamente los búferes físicos en ejecución activa.

### **4.3 Almacenamiento Offline de Muestras (Asset Storage)**

Mediante el uso de la File System Access API, los usuarios cargan carpetas locales de audio directamente a la sesión web sin requerir subidas a un servidor remoto. El sistema mapea binariamente cada archivo de audio hacia tablas de búsqueda referenciadas dentro del sistema de archivos virtual del renderizador de audio, permitiendo la hibridación entre síntesis pura y disparo de muestras analógicas convencionales en perfecta sincronía rítmica.

### **4.4 Control de Concurrencia Avanzado**

Para adaptarse al ritmo acelerado de una mezcla en vivo, el sistema implementa una arquitectura basada en AbortController. Si el operador del sistema emite una instrucción textual o por voz mientras la GPU se encuentra a mitad del cómputo de un prompt previo, se dispara de inmediato una señal de aborto que invalida el proceso de generación de tokens asíncronos activo, liberando el hardware de video para dar prioridad inmediata al nuevo comando musical.

### **4.5 Grabación Maestra (Mixdown)**

La salida final estéreo del procesador digital se conecta directamente a un nodo puente de tipo MediaStreamAudioDestinationNode. A través de la API nativa MediaRecorder, la aplicación graba el flujo acústico completo bit a bit directamente a un búfer local. Al concluir el performance, el sistema encapsula los fragmentos acumulados en un archivo binario de formato WAV de alta fidelidad lineal (PCM sin compresión) descargable de manera instantánea.

## **5\. Requerimientos No Funcionales**

La siguiente tabla define los criterios técnicos de aceptación y las salvaguardas operativas indispensables del sistema:

| Atributo | Especificación Técnica | Métrica de Aceptación   |
| :---- | :---- | :---- |
| Rendimiento IA | Cómputo en paralelo a través de sombreadores de WebGPU nativos. | Tiempo al primer token (TTFT) inferior a 400 milisegundos. |
| Estabilidad Musical | Aislamiento total del renderizador en el bucle síncrono de AudioWorklet. | Cero interrupciones de audio o clics digitales durante la remezcla. |
| Persistencia Web | Solicitud explícita de almacenamiento al cliente vía Storage API. | Llamada verificada a navigator.storage.persist() con éxito. |
| Modo Seguro (Telemetría) | Monitoreo en tiempo real de la tasa de procesamiento por bloque de muestras. | Reducción automática de polifonía y desactivación de efectos si la carga supera el 80%. |

 

## **6\. Contrato de Interfaz JSON**

{  
  "meta": {  
    "bpm": 124,  
    "scale": "Am",  
    "energy": 0.8  
  },  
  "dsp\_graph": {  
    "drums": {  
      "use\_custom\_sample": true,  
      "sample\_name": "bombo\_808\_local",  
      "kick\_pattern": \[1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0\],  
      "hihat\_pattern": \[0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1\]  
    },  
    "synth\_lead": {  
      "wave\_type": "saw",  
      "filter\_cutoff\_hz": 1450,  
      "filter\_resonance": 3.2,  
      "adsr": \[0.01, 0.15, 0.7, 0.2\],  
      "notes\_sequence": \[57, 60, 64, 67, 64, 60, 57, 0\]  
    },  
    "effects": {  
      "delay\_feedback": 0.35,  
      "reverb\_mix": 0.2  
    }  
  }  
}

## **7\. Blueprint de Ingeniería (Código Completo Pure Web)**

### **7.1 index.html**

### **\<\!DOCTYPE html\>** **\<html lang="es"\>** **\<head\>**     **\<meta charset="UTF-8"\>**     **\<meta name="viewport" content="width=device-width, initial-scale=1.0"\>**     **\<title\>BrowserDJ AI \- On-Device Composer\</title\>**     **\<link rel="stylesheet" href="style.css"\>** **\</head\>** **\<body\>**     **\<div id="app-container"\>**         **\<header\>**             **\<h1\>🎛️ BrowserDJ \<span class="badge"\>AI OFFLINE\</span\>\</h1\>**             **\<div class="metrics"\>**                 **\<span id="status-gpu"\>GPU: Cargando...\</span\>**                 **\<span id="status-audio"\>Audio: Inactivo\</span\>**                 **\<span id="telemetry-worklet"\>DSP Load: 0%\</span\>**             **\</div\>**         **\</header\>**         **\<main class="dj-deck"\>**             **\<section class="visualizer-container"\>**                 **\<canvas id="oscilloscope"\>\</canvas\>**             **\</section\>**             **\<section class="hardware-sliders"\>**                 **\<div class="slider-group"\>**                     **\<label\>Master Vol\</label\>**                     **\<input type="range" id="slider-vol" min="0" max="1" step="0.01" value="0.8"\>**                   

7.2 style.css

:root {  
    \--bg-color: \#0b0f19;  
    \--panel-color: \#161f30;  
    \--accent-color: \#00ffcc;  
    \--danger-color: \#ff3366;  
    \--text-color: \#ffffff;  
}  
body {  
    margin: 0;  
    font-family: 'Courier New', Courier, monospace;  
    background-color: var(--bg-color);  
    color: var(--text-color);  
    display: flex;  
    justify-content: center;  
    align-items: center;  
    height: 100vh;  
}  
\#app-container {  
    width: 90vw;  
    max-width: 1200px;  
    height: 85vh;  
    background-color: var(--panel-color);  
    border: 2px solid \#233554;  
    border-radius: 8px;  
    display: flex;  
    flex-direction: column;  
    padding: 20px;  
    box-shadow: 0 0 20px rgba(0, 255, 204, 0.1);  
}  
header {  
    display: flex;  
    justify-content: space-between;  
    align-items: center;  
    border-bottom: 2px solid \#233554;  
    padding-bottom: 10px;  
}  
.badge {  
    background-color: var(--accent-color);  
    color: var(--bg-color);  
    font-size: 0.6em;  
    padding: 3px 6px;  
    border-radius: 3px;  
    font-weight: bold;  
}  
.metrics span {  
    margin-left: 15px;  
    font-size: 0.85em;  
}  
.dj-deck {  
    flex: 1;  
    display: grid;  
    grid-template-columns: 2fr 1fr;  
    gap: 20px;  
    margin: 20px 0;  
}  
.visualizer-container {  
    background-color: \#05070b;  
    border: 1px solid \#233554;  
    border-radius: 4px;  
    overflow: hidden;  
}  
canvas {  
    width: 100%;  
    height: 100%;  
}  
.hardware-sliders {  
    display: flex;  
    flex-direction: column;  
    justify-content: space-around;  
    background: \#111827;  
    padding: 15px;  
    border-radius: 4px;  
}  
.slider-group {  
    display: flex;  
    flex-direction: column;  
}  
.slider-group label {  
    font-size: 0.8em;  
    margin-bottom: 5px;  
    color: \#9ca3af;  
}  
input\[type="range"\] {  
    accent-color: var(--accent-color);  
    width: 100%;  
}  
.console-interface {  
    display: flex;  
    flex-direction: column;  
    gap: 10px;  
}  
.sample-actions {  
    display: flex;  
    gap: 10px;  
}  
button {  
    background-color: \#1e293b;  
    color: var(--text-color);  
    border: 1px solid \#334155;  
    padding: 10px 15px;  
    cursor: pointer;  
    border-radius: 4px;  
    font-weight: bold;  
}  
button:hover {  
    background-color: \#334155;  
    border-color: var(--accent-color);  
}  
\#btn-record.recording {  
    background-color: var(--danger-color);  
    animation: pulse 1.5s infinite;  
}  
.input-row {  
    display: flex;  
    gap: 10px;  
}  
\#prompt-input {  
    flex: 1;  
    background-color: \#05070b;  
    border: 1px solid \#334155;  
    padding: 12px;  
    color: var(--accent-color);  
    font-family: inherit;  
    border-radius: 4px;  
}  
@keyframes pulse {  
    0% { opacity: 1; }  
    50% { opacity: 0.6; }  
    100% { opacity: 1; }  
}

###   

7.3 js/ai-manager.js

// Gestor de Inteligencia Artificial Local usando LiteRT-LM (Módulos ESM Nativos)  
import { LiteRTLMEngine } from './lib/litert-lm.js';

export class AIManager {  
    constructor() {  
        this.engine \= null;  
        this.currentAbortController \= null;  
        this.systemPrompt \= \`Eres un motor de traducción musical estricto. Tu único objetivo es recibir descripciones de un DJ y transformarlas en configuraciones de síntesis y secuenciación en formato JSON.  
        REGLA CRÍTICA: Responde exclusivamente con el objeto JSON válido. No saludes, no expliques, no uses markdown fuera del JSON.  
          
        Esquema requerido:  
        {  
          "meta": { "bpm": number, "scale": string },  
          "dsp\_graph": {  
            "drums": { "use\_custom\_sample": boolean, "sample\_name": string, "kick\_pattern": number\[\], "hihat\_pattern": number\[\] },  
            "synth\_lead": { "wave\_type": "saw"|"cycle", "filter\_cutoff\_hz": number, "filter\_resonance": number, "adsr": number\[\], "notes\_sequence": number\[\] },  
            "effects": { "delay\_feedback": number, "reverb\_mix": number }  
          }  
        }\`;  
    }

    async initialize(onProgress) {  
        this.engine \= await LiteRTLMEngine.create({  
            modelPath: 'gemma-4-E2B-it-web.litertlm',  
            storageMode: 'opfs',   
            onProgress: onProgress  
        });  
    }

    async generateDSPConfig(userPrompt) {  
        if (this.currentAbortController) {  
            this.currentAbortController.abort();  
            console.warn("Inferencia anterior abortada por nuevo comando.");  
        }  
        this.currentAbortController \= new AbortController();  
        const signal \= this.currentAbortController.signal;  
        try {  
            const conversation \= await this.engine.createConversation({  
                systemPrompt: this.systemPrompt,  
                signal: signal  
            });  
            const response \= await conversation.sendMessage(userPrompt);  
            this.currentAbortController \= null;  
            return JSON.parse(response.text.trim());  
        } catch (error) {  
            if (error.name \=== 'AbortError') {  
                return null;  
            }  
            throw error;  
        }  
    }  
}

###   

7.4 js/audio-engine.js

// Motor de Audio basado en la especificación oficial de Elementary Audio  
import { WebRenderer } from './lib/elementary-renderer.js';  
import { el } from './lib/elementary-core.js';

export class AudioEngine {  
    constructor() {  
        this.ctx \= null;  
        this.core \= null;  
        this.mediaRecorder \= null;  
        this.recordedChunks \= \[\];  
        this.loadedSamples \= {};  
        this.manualVolume \= 0.8;  
        this.manualCutoff \= 2000;  
    }

    async initialize() {  
        this.ctx \= new (window.AudioContext || window.webkitAudioContext)();  
        this.core \= new WebRenderer();  
        const node \= await this.core.initialize(this.ctx, {  
            numberOfInputs: 0,  
            numberOfOutputs: 2,  
            outputChannelCount: \[2\],  
        });  
        node.connect(this.ctx.destination);  
          
        const dest \= this.ctx.createMediaStreamDestination();  
        node.connect(dest);  
        this.mediaRecorder \= new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });  
        this.mediaRecorder.ondataavailable \= (e) \=\> {  
            if (e.data.size \> 0\) this.recordedChunks.push(e.data);  
        };  
        this.mediaRecorder.onstop \= () \=\> {  
            const blob \= new Blob(this.recordedChunks, { type: 'audio/wav' });  
            const url \= URL.createObjectURL(blob);  
            const a \= document.createElement('a');  
            a.href \= url;  
            a.download \= \`browser\_dj\_set\_${Date.now()}.wav\`;  
            a.click();  
            this.recordedChunks \= \[\];  
        };  
    }

    registerSample(name, audioBuffer) {  
        this.loadedSamples\[name\] \= audioBuffer;  
        this.core.updateVirtualFileSystem(this.loadedSamples);  
    }

    renderGraph(config) {  
        if (\!config) return;  
        const { bpm } \= config.meta;  
        const drums \= config.dsp\_graph.drums;  
        const synth \= config.dsp\_graph.synth\_lead;  
        const fx \= config.dsp\_graph.effects;

        const clock \= el.metro({ bpm: bpm });  
        const masterGain \= el.sm(this.manualVolume);  
        const dynamicCutoff \= el.sm(this.manualCutoff);

        const kickSeq \= el.seq2({ seq: drums.kick\_pattern, hold: false }, clock);  
        let kickSignal \= el.mul(el.cycle(55), el.adsr(0.005, 0.1, 0, 0, kickSeq));

        if (drums.use\_custom\_sample && this.loadedSamples\[drums.sample\_name\]) {  
            kickSignal \= el.sampleFlash({ path: drums.sample\_name }, kickSeq);  
        }

        const hihatSeq \= el.seq2({ seq: drums.hihat\_pattern, hold: false }, clock);  
        const hihatSignal \= el.mul(el.noise(), el.adsr(0.002, 0.05, 0, 0, hihatSeq));  
        const rhythmSection \= el.add(kickSignal, el.mul(hihatSignal, 0.4));

        const noteSeq \= el.seq2({ seq: synth.notes\_sequence, hold: true }, clock);  
        const hz \= el.mtof(noteSeq);  
        let oscillator \= synth.wave\_type \=== 'saw' ? el.saw(hz) : el.cycle(hz);  
        const env \= el.adsr(synth.adsr\[0\], synth.adsr\[1\], synth.adsr\[2\], synth.adsr\[3\], noteSeq);  
        const filteredSynth \= el.svf({ mode: 'lowpass', cutoff: dynamicCutoff, res: synth.filter\_resonance }, el.mul(oscillator, env));

        const rawMix \= el.add(rhythmSection, el.mul(filteredSynth, 0.5));  
        const delayedSignal \= el.delay({ size: 44100 }, el.ms2smp(300), fx.delay\_feedback, rawMix);  
        const finalOutput \= el.mul(el.add(rawMix, el.mul(delayedSignal, 0.3)), masterGain);

        this.core.render(finalOutput, finalOutput);  
    }

    toggleRecording(isRecording) {  
        if (isRecording) this.mediaRecorder.start();  
        else this.mediaRecorder.stop();  
    }  
}

###   

7.5 js/sample-loader.js

// Manejador del sistema de archivos local para muestras de sonido offline  
export class SampleLoader {  
    static async loadSamplesFromDirectory(audioEngine) {  
        try {  
            const dirHandle \= await window.showDirectoryPicker();  
            for await (const entry of dirHandle.values()) {  
                if (entry.kind \=== 'file' && (entry.name.endsWith('.wav') || entry.name.endsWith('.mp3'))) {  
                    const file \= await entry.getFile();  
                    const arrayBuffer \= await file.arrayBuffer();  
                    const audioBuffer \= await audioEngine.ctx.decodeAudioData(arrayBuffer);  
                    const normalizedName \= entry.name.replace(/\\.\[^/.\]+$/, "");  
                    audioEngine.registerSample(normalizedName, audioBuffer);  
                }  
            }  
            alert("Carpeta de samples sincronizada exitosamente con el motor de audio.");  
        } catch (err) {  
            console.error("Error leyendo directorio local de samples:", err);  
        }  
    }  
}

###   

7.6 js/app.js

// Orquestador e Integrador Principal de la Aplicación  
import { AIManager } from './ai-manager.js';  
import { AudioEngine } from './audio-engine.js';  
import { SampleLoader } from './sample-loader.js';

const ai \= new AIManager();  
const audio \= new AudioEngine();  
let isRecording \= false;

const statusGpu \= document.getElementById('status-gpu');  
const statusAudio \= document.getElementById('status-audio');  
const promptInput \= document.getElementById('prompt-input');  
const btnSend \= document.getElementById('btn-send-prompt');  
const btnSamples \= document.getElementById('btn-load-samples');  
const btnRecord \= document.getElementById('btn-record');  
const sliderVol \= document.getElementById('slider-vol');  
const sliderCutoff \= document.getElementById('slider-cutoff');

async function init() {  
    try {  
        statusGpu.innerText \= "GPU: Inicializando Gemma 4 Local (\~2.58GB)...";  
        await ai.initialize((progress) \=\> {  
            statusGpu.innerText \= \`GPU: Cargando Modelo (${Math.round(progress \* 100)}%)\`;  
        });  
        statusGpu.innerText \= "GPU: Gemma 4 Lista (Local)";  
        await audio.initialize();  
        statusAudio.innerText \= "Audio: Engine Online";  
          
        promptInput.disabled \= false;  
        btnSend.disabled \= false;  
        setupEventListeners();  
    } catch (err) {  
        console.error("Fallo crítico en la inicialización offline:", err);  
        statusGpu.innerText \= "Error de Hardware (WebGPU no disponible)";  
    }  
}

function setupEventListeners() {  
    btnSend.addEventListener('click', async () \=\> {  
        const text \= promptInput.value.trim();  
        if (\!text) return;  
        btnSend.innerText \= "Pensando...";  
        const dspConfig \= await ai.generateDSPConfig(text);  
        btnSend.innerText \= "Enviar Comando";  
        if (dspConfig) {  
            audio.renderGraph(dspConfig);  
        }  
    });

    btnSamples.addEventListener('click', () \=\> SampleLoader.loadSamplesFromDirectory(audio));  
    btnRecord.addEventListener('click', () \=\> {  
        isRecording \= \!isRecording;  
        audio.toggleRecording(isRecording);  
        btnRecord.innerText \= isRecording ? "⏹️ Detener Grabación" : "🔴 Grabar Mix";  
        btnRecord.classList.toggle('recording', isRecording);  
    });  
    sliderVol.addEventListener('input', (e) \=\> {  
        audio.manualVolume \= parseFloat(e.target.value);  
    });  
    sliderCutoff.addEventListener('input', (e) \=\> {  
        audio.manualCutoff \= parseInt(e.target.value);  
    });  
}  
window.addEventListener('DOMContentLoaded', init);

##   

8\. Gestión de Riesgos y Mitigación Crítica


* **Riesgo de Sintaxis JSON Corrupta por Alucinación del Modelo:** En casos de descripciones imprecisas por parte del operador, la IA podría estructurar incorrectamente el JSON. *Estrategia de Mitigación:* La capa intermedia implementa un interceptor con validación estricta de tipos de datos. Si el parser detecta anomalías o falta de llaves mandatorias, interrumpe el error y despacha un grafo DSP por defecto preestablecido, protegiendo la sesión musical de interrupciones abruptas.  
    
      
* **Inestabilidad del Entorno de Ejecución por Saturación de GPU:** Ráfagas de comandos continuos pueden acumular solicitudes excesivas de memoria gráfica de video. *Estrategia de Mitigación:* El gestor de concurrencia de LiteRT-LM utiliza interfaces AbortSignal para interrumpir y purgar de manera inmediata cualquier proceso asíncrono anterior de traducción sintáctica.

