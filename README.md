# BrowserDJ AI — Analog Precision (AP-808)

> Estación de trabajo de audio digital y sintetizador procedural impulsado por IA local en el navegador, 100% offline, sin APIs externas ni claves requeridas.

**Demo en vivo:** [https://seagomezar.github.io/djintheedge/](https://seagomezar.github.io/djintheedge/)

---

## Características Principales

1. **Diseño Hardware Analógico Vintage ("Analog Precision"):**
   - Chasis industrial color crema marfil con tornillos mecánicos de montaje a 45°.
   - Secuenciador rítmico de 16 pasos estilo Roland TR-808 con teclas táctiles de colores clásicos y pines LED de filamento incandescente ámbar.
   - Osciloscopio vectorial sobre marco CRT negro embutido con persistencia de fósforo cálido (`#fea619`) y retícula milimétrica serigrafiada.
   - Consola de 5 faders analógicos (Volumen, Cutoff, Reverb, Delay y Compás) deslizándose sobre rieles maquinados con lectura digital.

2. **Internacionalización Integral (i18n):**
   - Soporte multilingüe completo para **Español (`ES`)**, **Inglés (`EN`)** y **Portugués (`PT`)**.
   - Selector táctil de 3 posiciones empotrado en el bisel de aluminio superior con LEDs ámbar individuales.
   - Conmutación en tiempo real sin recarga de página: títulos, controles, faders, mute strip, bancos de presets y lecturas de telemetría.
   - Comprensión NLP en lenguaje natural para prompts en español, inglés y portugués (ej. *"ritmo techno a 135 bpm com dente de serra e sem bateria"*).

3. **Motor de Síntesis y Audio Procedural:**
   - Generación en tiempo real con Web Audio API.
   - Formas de onda: Sierra (*Saw*), Cuadrada (*Square*) y Senoidal (*Cycle*).
   - Filtro paso-bajo resonante SVF y efectos integrados de reverberación y retardo (*delay*).
   - Conmutadores mecánicos de silenciamiento (*Mute / Solo*) para Bombo, Platillos y Sintetizador Lead.
   - Modulación y morfosis progresiva de acordes, escalas y redobles de batería hacia drops.

---

## Inicio Rápido (Desarrollo Local)

Requisitos: [Node.js](https://nodejs.org/) 20+

```bash
# Clonar el repositorio
git clone https://github.com/seagomezar/djintheedge.git
cd djintheedge

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo Vite
npm run dev

# Ejecutar suite de pruebas unitarias (Vitest)
npm test

# Compilar para producción
npm run build
```

---

## Despliegue en GitHub Pages

El proyecto se compila y despliega automáticamente en cada `push` a la rama `main` a través del flujo de GitHub Actions configurado en `.github/workflows/deploy.yml`.

---

## Licencia

Distribuido bajo la Licencia [MIT](LICENSE).
