# normas-jmsr

Monitoreo de normas legales y proyectos de ley del Perú por áreas (minería, agro, economía, etc.).
Las claves y direcciones de conexión solo van en los secretos de GitHub y en Vercel; nunca en el código.
El registro de las tareas es público: ninguna tarea imprime claves ni direcciones (se tapan con `::add-mask::`).

## Secretos de GitHub

| Secreto | Para qué |
|---|---|
| `NEON_API_KEY` | Cuenta de Neon nueva: de aquí salen las direcciones de las 8 bases (`src/neon_urls.py`) |
| `NEON_API_KEY_ANTERIOR` | Solo para copiar los datos del sistema anterior (se puede borrar después) |
| `GEMINI_API_KEY` | IA (Google AI Studio, plan gratuito) |
| `VERCEL_TOKEN` | Para que «Configurar Vercel» copie las claves a la web |
| `GITHUB_TAREAS` | Para que la web lance «Revisar este mes» al momento |
| `ADMIN_CLAVE_INICIAL` | Contraseña del primer administrador (se puede borrar después) |

## Puesta en marcha

1. Actions → «Copiar datos del sistema anterior» → modo `revisar` (muestra el plan) y luego `copiar`.
2. Crear el proyecto `normas-jmsr` en Vercel (importando este repositorio) y lanzar «Configurar Vercel».
3. Guardar el secreto `ADMIN_CLAVE_INICIAL` (la contraseña) y lanzar «Crear administrador».
4. Encender los horarios del programador (`programador.yml`) y de `cupos.yml`.

## Tareas de la noche (hora de Lima)

Ver `src/programador.py`. El monitoreo por áreas (`areas.yml`, 3:40) atiende primero los pedidos
«Revisar este mes», luego el mes en curso de todas las áreas y después los meses anteriores, hasta 2015.
