"""Prueba si el servicio del portal del Congreso tiene proyectos de periodos anteriores a 2021.
Solo lee (unas pocas consultas); no guarda nada."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import congreso  # noqa: E402
import seguimiento  # noqa: E402

print("Periodos que lista el portal:")
for p in congreso.periodos():
    print("  ", json.dumps(p, ensure_ascii=False)[:300])

for per in (2016, 2011, 2006, 2001, 1995):
    for cam in ("C",):
        try:
            d = congreso._con_reintentos(congreso._s.post, f"{congreso.API}/proyecto-ley/lista-con-filtro",
                                         json=congreso._cuerpo(per, cam, 0))["data"]
        except Exception as e:  # noqa: BLE001
            print(f"\nPeriodo {per}: error {e}")
            continue
        lote = d.get("proyectos") or []
        print(f"\nPeriodo {per} camara {cam}: total {d.get('rowsTotal')}")
        for x in lote[:2]:
            print("   ", json.dumps({k: x.get(k) for k in ("perParId", "pleyNum", "proyectoLey", "fecPresentacion",
                                                        "titulo", "desEstado", "desProponente", "autores")},
                                    ensure_ascii=False)[:400])
        mas_antiguo = None
        if d.get("rowsTotal"):
            ult = congreso._con_reintentos(congreso._s.post, f"{congreso.API}/proyecto-ley/lista-con-filtro",
                                           json=congreso._cuerpo(per, cam, max(0, d["rowsTotal"] - 1)))["data"]
            mas_antiguo = (ult.get("proyectos") or [{}])[-1]
            print("    ultimo de la lista:", mas_antiguo.get("proyectoLey"), mas_antiguo.get("fecPresentacion"))
        if lote:
            try:
                e = seguimiento.expediente(per, cam, lote[0].get("pleyNum"))
                if e:
                    segs = e.get("seguimientos") or []
                    print(f"    expediente: {len(segs)} pasos de seguimiento; archivos: {len(e.get('archivos') or [])}")
                    if segs:
                        print("     ", json.dumps(segs[0], ensure_ascii=False)[:300])
            except Exception as ex:  # noqa: BLE001
                print(f"    expediente: error {ex}")
