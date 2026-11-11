"""Lee las reglas para robots (robots.txt) de los sitios antiguos del Congreso. Solo lee."""
import requests
for url in ("https://www2.congreso.gob.pe/robots.txt", "https://www.leyes.congreso.gob.pe/robots.txt",
            "https://leyes.congreso.gob.pe/robots.txt"):
    try:
        r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0 (compatible; normas-jmsr/0.2)"})
        print(f"== {url} -> {r.status_code}\n{r.text[:800]}")
    except Exception as e:  # noqa: BLE001
        print(f"== {url} -> error {e}")
