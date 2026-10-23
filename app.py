import os
import re
import uuid
import subprocess
from pathlib import Path
from flask import Flask, render_template, request, send_from_directory, flash, redirect, url_for

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "change-this-local-demo-key")
UPLOAD_DIR = Path("/app/uploads")
OUTPUT_DIR = Path("/app/output")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Search links open each provider's own search page. This avoids scraping sites
# or copying models without permission.
PROVIDERS = [
    ("Printables", "https://www.printables.com/search/models?q={q}"),
    ("Thingiverse", "https://www.thingiverse.com/search?q={q}"),
    ("MakerWorld", "https://makerworld.com/en/search/models?keyword={q}"),
    ("Yeggi", "https://www.yeggi.com/q/{q}/"),
]

@app.get("/")
def home():
    query = request.args.get("q", "").strip()
    links = []
    if query:
        from urllib.parse import quote_plus
        encoded = quote_plus(query)
        links = [{"name": name, "url": template.format(q=encoded)} for name, template in PROVIDERS]
    return render_template("index.html", query=query, links=links)

@app.post("/slice")
def slice_model():
    upload = request.files.get("model")
    if not upload or not upload.filename:
        flash("Kies eerst een STL-bestand.")
        return redirect(url_for("home"))
    safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", upload.filename)
    if not safe_name.lower().endswith(".stl"):
        flash("Deze eerste versie accepteert STL-bestanden. Download het model als STL.")
        return redirect(url_for("home"))
    if request.content_length and request.content_length > 100 * 1024 * 1024:
        flash("Het bestand is groter dan 100 MB.")
        return redirect(url_for("home"))

    job_id = uuid.uuid4().hex[:10]
    stl_path = UPLOAD_DIR / f"{job_id}_{safe_name}"
    out_name = f"{Path(safe_name).stem}_Ender3S1_PLA.gcode"
    out_path = OUTPUT_DIR / f"{job_id}_{out_name}"
    upload.save(stl_path)

    # CuraEngine needs its definition/resource files and machine settings.
    # The Docker image's availability of these files varies by distro, so
    # we check before running and report a clear error instead of a fake G-code.
    executable = next((p for p in ["/usr/bin/CuraEngine", "/usr/bin/cura-engine"] if Path(p).exists()), None)
    if not executable:
        flash("CuraEngine is niet gevonden in de container. Controleer de Docker-build en CuraEngine-installatie.")
        return redirect(url_for("home"))

    # Do not produce a file unless slicing succeeds. This intentionally avoids
    # guessing machine definitions: incorrect start/end G-code can damage hardware.
    result = subprocess.run([executable, "help"], capture_output=True, text=True, timeout=15)
    flash("Het STL-bestand is ontvangen, maar deze basisinstallatie heeft nog een volledig Cura-profiel nodig. Daarom maakt hij nog geen G-code. Gebruik de installatiehandleiding om het officiële Ender 3 S1-profiel en start-/eind-G-code toe te voegen.")
    return redirect(url_for("home"))

@app.get("/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8088)
