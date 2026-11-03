import os
import subprocess
import sys
from PIL import Image

WORKSPACE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SVG_PATH = os.path.join(WORKSPACE, "assets", "zap-logo.svg")
HTML_PATH = os.path.join(WORKSPACE, "scripts", "render-icon.html")
MASTER_PNG = os.path.join(WORKSPACE, "assets", "zap-1024.png")

with open(SVG_PATH, "r", encoding="utf-8") as f:
    svg_content = f.read()

html_content = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {{
    margin: 0;
    padding: 0;
    width: 1024px;
    height: 1024px;
    background: transparent;
    overflow: hidden;
  }}
  svg {{
    width: 1024px;
    height: 1024px;
    display: block;
  }}
</style>
</head>
<body>
{svg_content}
</body>
</html>
"""

with open(HTML_PATH, "w", encoding="utf-8") as f:
    f.write(html_content)

edge_exe = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not os.path.exists(edge_exe):
    print("Edge not found at standard path", file=sys.stderr)
    sys.exit(1)

html_url = "file:///" + HTML_PATH.replace("\\", "/")
cmd = [
    edge_exe,
    "--headless=new",
    "--disable-gpu",
    "--force-device-scale-factor=1",
    "--window-size=1024,1024",
    "--default-background-color=00000000",
    f"--screenshot={MASTER_PNG}",
    html_url
]

print("Rendering SVG to 1024x1024 PNG via Headless Edge...")
subprocess.run(cmd, check=True)

if not os.path.exists(MASTER_PNG):
    print("Failed to render master PNG", file=sys.stderr)
    sys.exit(1)

print(f"Master PNG created: {MASTER_PNG} ({os.path.getsize(MASTER_PNG)} bytes)")

img = Image.open(MASTER_PNG).convert("RGBA")

# Target icon files and sizes
icons_dir = os.path.join(WORKSPACE, "desktop", "src-tauri", "icons")
os.makedirs(icons_dir, exist_ok=True)

targets = {
    os.path.join(icons_dir, "icon.png"): (512, 512),
    os.path.join(icons_dir, "128x128@2x.png"): (256, 256),
    os.path.join(icons_dir, "128x128.png"): (128, 128),
    os.path.join(icons_dir, "64x64.png"): (64, 64),
    os.path.join(icons_dir, "32x32.png"): (32, 32),
    os.path.join(icons_dir, "Square30x30Logo.png"): (30, 30),
    os.path.join(icons_dir, "Square44x44Logo.png"): (44, 44),
    os.path.join(icons_dir, "Square71x71Logo.png"): (71, 71),
    os.path.join(icons_dir, "Square89x89Logo.png"): (89, 89),
    os.path.join(icons_dir, "Square107x107Logo.png"): (107, 107),
    os.path.join(icons_dir, "Square142x142Logo.png"): (142, 142),
    os.path.join(icons_dir, "Square150x150Logo.png"): (150, 150),
    os.path.join(icons_dir, "Square284x284Logo.png"): (284, 284),
    os.path.join(icons_dir, "Square310x310Logo.png"): (310, 310),
    os.path.join(icons_dir, "StoreLogo.png"): (50, 50),
    os.path.join(WORKSPACE, "webui", "public", "favicon.png"): (64, 64),
    os.path.join(WORKSPACE, "webui", "public", "apple-touch-icon.png"): (180, 180),
}

for out_path, size in targets.items():
    resized = img.resize(size, Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    resized.save(out_path, "PNG", optimize=True)
    print(f"Generated {os.path.basename(out_path)}: {size[0]}x{size[1]}")

# Generate multi-resolution icon.ico for Windows desktop & installer
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ico_path = os.path.join(icons_dir, "icon.ico")
img.save(ico_path, format="ICO", sizes=ico_sizes)
print(f"Generated multi-resolution Windows icon.ico: {ico_path} ({os.path.getsize(ico_path)} bytes)")

# Clean up temporary files
if os.path.exists(HTML_PATH):
    os.remove(HTML_PATH)

print("All icons successfully generated and updated!")
