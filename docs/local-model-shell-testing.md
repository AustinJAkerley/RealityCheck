# Local model shell testing (matches extension input/output)

This mode lets you throw images at the bundled local model from the shell and print the same response shape the extension uses in high mode:

- `decisionStage: local_ml`
- `score`
- binary verdict (`AI generated` / `Not AI generated`)

## 1) Convert an image to the extension-style payload

The extension sends a `64x64` RGBA buffer to the local model.  
Create the same payload in shell:

```bash
python -m pip install pillow
python - <<'PY'
from PIL import Image
import json, sys

input_path = sys.argv[1] if len(sys.argv) > 1 else '/absolute/path/to/image.jpg'
output_path = sys.argv[2] if len(sys.argv) > 2 else '/tmp/rc-local-model-payload.json'

img = Image.open(input_path).convert('RGBA').resize((64, 64))
data = list(img.tobytes())  # flat RGBA buffer
payload = {"width": 64, "height": 64, "data": data}
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(payload, f)
print(output_path)
PY /absolute/path/to/image.jpg /tmp/rc-local-model-payload.json
```

## 2) Run the bundled local model through Jest shell mode

```bash
cd /path/to/RealityCheck/packages/core
RC_LOCAL_MODEL_RGBA_JSON=/tmp/rc-local-model-payload.json \
npx jest --no-coverage --runInBand tests/local-model-shell.test.ts
```

You will get a console line like:

```json
{
  "score": 0.95,
  "verdict": "AI generated",
  "decisionStage": "local_ml"
}
```

## 3) Validate what users see in extension

With the extension in `high` quality mode:

- Console logs show image/video detection with stage + model/remote details.
- Watermark badge includes the flow stage:
  - `Flow: Initial`
  - `Flow: Local ML`
  - `Flow: Remote ML`
