# 📋 BOT SUNAT - Buzón Electrónico Inteligente

Plataforma tipo chat para centralizar, leer y resumir notificaciones del buzón SUNAT.

## 🚀 Inicio Rápido (Local)

### Requisitos
- Python 3.11+
- Node.js 18+

### Arrancar

```bash
# Windows — doble clic en:
start.bat

# O manualmente:
# Terminal 1 - Backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend
npm install
npm run dev
```

Abrir: http://localhost:5173

---

## ☁️ Despliegue en la Nube (Gratuito)

### Backend → Railway.app

1. Crear cuenta en https://railway.app (gratis)
2. "New Project" → "Deploy from GitHub"
3. Conectar tu repo, seleccionar carpeta `/backend`
4. Variables de entorno en Railway:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=tu@gmail.com
   SMTP_PASS=tu_app_password
   SECRET_KEY=clave_aleatoria_larga
   ```
5. Railway detecta FastAPI automáticamente y despliega.
6. Copia la URL pública: `https://tuapp.railway.app`

### Frontend → Vercel.com

1. Crear cuenta en https://vercel.com (gratis)
2. "New Project" → importar repo → seleccionar carpeta `/frontend`
3. Variable de entorno: `VITE_API_URL=https://tuapp.railway.app`
4. En `vite.config.js` ajustar proxy a la URL de Railway.
5. Deploy automático.

---

## 🔧 Configuración de Email (Gmail)

1. Ir a tu cuenta Google → Seguridad → Contraseñas de Aplicación
2. Crear una contraseña para "Correo" en "Windows"
3. Copiar el código de 16 caracteres
4. En el archivo `.env` del backend:
   ```
   SMTP_USER=tuCorreo@gmail.com
   SMTP_PASS=abcd efgh ijkl mnop
   ```

---

## 🤖 Configurar Claude API (Resúmenes Inteligentes)

1. Ir a https://console.anthropic.com
2. Crear API Key
3. En `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   Sin API Key, el bot usa resúmenes básicos automáticamente.

---

## 📁 Estructura del Proyecto

```
BOT SUNAT/
├── backend/
│   ├── app/
│   │   ├── main.py          ← API FastAPI (endpoints)
│   │   ├── scraper.py       ← Scraping buzón SUNAT con Playwright
│   │   ├── database.py      ← SQLite + modelos
│   │   ├── email_service.py ← Envío de correos HTML
│   │   └── ai_summary.py    ← Resúmenes con Claude
│   ├── requirements.txt
│   └── .env                 ← Credenciales (NO subir a git)
├── frontend/
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── LoginForm.jsx
│           ├── ChatInterface.jsx
│           └── NotificationCard.jsx
├── start.bat                ← Arranque con doble clic (Windows)
└── README.md
```

---

## 🔐 Seguridad

- Las contraseñas SUNAT **nunca se guardan** en base de datos
- Solo existen en memoria durante la sesión activa
- Al cerrar sesión se eliminan inmediatamente
- Las notificaciones se marcan leídas **solo con confirmación explícita**

---

## 🧪 Modo Demo

En la pantalla de login, hacer clic en **"Probar con datos de demostración"** para ver la app sin credenciales reales.
