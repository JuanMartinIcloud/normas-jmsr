"""Lista inicial de areas del monitoreo (se cargan en la tabla «areas» la primera vez).

La descripcion le dice a la IA que abarca cada area; los usuarios pueden agregar otras con «Otra área».
"""

AREAS_BASE = [
    ("Economía y finanzas públicas",
     "Política económica y fiscal, presupuesto, endeudamiento, inversión pública, tesoro, crecimiento y "
     "clima de inversiones en general."),
    ("Tributario",
     "Impuestos, tasas y contribuciones (IGV, renta, ISC, regalías y tributos municipales), SUNAT, "
     "beneficios y exoneraciones tributarias, fraccionamientos y sanciones tributarias."),
    ("Comercio exterior y aduanas",
     "Exportaciones, importaciones, aranceles, aduanas, tratados de libre comercio, zonas francas y "
     "ventanilla única."),
    ("Banca, seguros y mercado de valores",
     "Sistema financiero, SBS, SMV, bancos, cajas, cooperativas, seguros, AFP, fintech, mercado de "
     "valores y prevención del lavado de activos."),
    ("Minería",
     "Actividad minera grande, mediana, pequeña y artesanal: concesiones, formalización (REINFO), "
     "regalías, cierre de minas, conflictos sociales mineros y autoridades del sector minero."),
    ("Hidrocarburos",
     "Petróleo y gas natural: exploración, explotación, lotes, Perupetro, Petroperú, transporte por "
     "ductos, distribución de gas y combustibles."),
    ("Electricidad",
     "Generación, transmisión y distribución eléctrica, tarifas, Osinergmin, energías renovables y "
     "electrificación rural."),
    ("Agro y agroindustria",
     "Agricultura, ganadería, riego, agroexportación, sanidad agraria (SENASA), régimen agrario, "
     "tierras y forestación productiva."),
    ("Pesca y acuicultura",
     "Pesca industrial y artesanal, cuotas y temporadas, vedas, acuicultura, sanidad pesquera "
     "(SANIPES) y Produce en materia pesquera."),
    ("Industria y manufactura",
     "Industria manufacturera, normas técnicas, calidad (INACAL), mypes industriales y política "
     "productiva."),
    ("Comercio interno y consumidor",
     "Comercio minorista, protección al consumidor, publicidad, libre competencia, INDECOPI, barreras "
     "burocráticas y propiedad intelectual."),
    ("Transportes y logística",
     "Transporte terrestre, aéreo, marítimo y ferroviario, puertos, aeropuertos, carreteras, "
     "concesiones viales, ATU, MTC y logística."),
    ("Telecomunicaciones y economía digital",
     "Telecomunicaciones, espectro, internet, OSIPTEL, servicios digitales, gobierno digital, "
     "protección de datos personales y ciberseguridad."),
    ("Construcción, vivienda e inmobiliario",
     "Construcción, vivienda, saneamiento, urbanismo, zonificación, licencias de edificación, "
     "propiedad inmobiliaria y programas de vivienda."),
    ("Infraestructura, APP e inversión privada",
     "Asociaciones público-privadas, obras por impuestos, ProInversión, grandes proyectos de "
     "infraestructura y destrabe de inversiones."),
    ("Medio ambiente",
     "Normas ambientales, OEFA, SENACE, evaluación de impacto ambiental, áreas naturales protegidas, "
     "recursos hídricos, residuos, cambio climático y fiscalización ambiental."),
    ("Laboral y seguridad social",
     "Derecho laboral, remuneraciones, régimen laboral público y privado, SUNAFIL, sindicatos, "
     "pensiones, EsSalud y seguridad y salud en el trabajo."),
    ("Salud y farmacéutico",
     "Salud pública, MINSA, DIGEMID, medicamentos, dispositivos médicos, clínicas, seguros de salud "
     "(SIS, SUSALUD) y emergencias sanitarias."),
    ("Educación",
     "Educación básica y superior, universidades, SUNEDU, institutos, docentes y educación privada."),
    ("Turismo y cultura",
     "Turismo, hoteles, agencias de viaje, patrimonio cultural, museos, industrias culturales y "
     "espectáculos."),
    ("Contrataciones del Estado",
     "Compras públicas, ley de contrataciones, OSCE, procesos de selección, obras públicas, arbitraje "
     "con el Estado y sanciones a proveedores."),
    ("Justicia y sistema penal",
     "Poder Judicial, Ministerio Público, Tribunal Constitucional, Código Penal y Procesal Penal, "
     "sistema penitenciario, extradiciones y procesos judiciales relevantes."),
    ("Seguridad ciudadana y defensa",
     "Policía Nacional, Fuerzas Armadas, orden interno, estados de emergencia, crimen organizado, "
     "terrorismo y defensa nacional."),
    ("Anticorrupción y transparencia",
     "Integridad pública, Contraloría, control gubernamental, conflictos de intereses, designaciones, "
     "renuncias y viajes cuestionables de autoridades, transparencia y acceso a la información."),
    ("Gobierno, Estado y elecciones",
     "Organización del Estado, Presidencia y PCM, ministerios, Congreso, gobiernos regionales y "
     "locales, descentralización, procesos electorales (JNE, ONPE) y partidos políticos."),
    ("Desarrollo social y pueblos indígenas",
     "Programas sociales, pobreza, MIDIS, MIMP, comunidades campesinas y nativas, consulta previa y "
     "poblaciones vulnerables."),
]
