#!/usr/bin/env python3
"""Show the solar dashboard on a Pimoroni Inky Impression 13.3" (1600 x 1200, Spectra 6).

The server already draws the image in the panel's six colours at the panel's
size, so this script only downloads it and pushes it to the display.

    pip install inky[rpi] pillow requests
    python3 show_solar.py --url http://<dashboard-pc>:8787/api/eink.png

Run it from cron every 15 minutes (SolarEdge data arrives in 15-minute steps;
a full Spectra 6 refresh takes ~30 s, so faster is pointless):

    */15 * * * * /usr/bin/python3 /home/pi/show_solar.py --url http://192.168.1.50:8787/api/eink.png
"""

import argparse
import io
import sys

import requests
from PIL import Image


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", required=True, help="the dashboard's /api/eink.png address")
    parser.add_argument("--rotate", type=int, default=0, choices=[0, 180], help="180 if the panel is mounted upside down")
    parser.add_argument("--saturation", type=float, default=0.5, help="Inky colour saturation, 0-1")
    args = parser.parse_args()

    try:
        response = requests.get(args.url, timeout=60)
        response.raise_for_status()
    except requests.RequestException as err:
        print(f"Could not fetch {args.url}: {err}", file=sys.stderr)
        return 1

    image = Image.open(io.BytesIO(response.content)).convert("RGB")
    if args.rotate:
        image = image.rotate(args.rotate)

    from inky.auto import auto  # imported late so --help works off the Pi

    display = auto(ask_user=False, verbose=False)
    if image.size != display.resolution:
        image = image.resize(display.resolution)
    display.set_image(image, saturation=args.saturation)
    display.show()
    return 0


if __name__ == "__main__":
    sys.exit(main())
