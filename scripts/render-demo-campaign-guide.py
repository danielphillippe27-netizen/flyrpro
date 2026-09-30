"""Render the silent, captioned first-campaign guide used by the interactive demo."""

from pathlib import Path
import math
import subprocess

from PIL import Image, ImageDraw, ImageFont

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/demo/campaign-boundary-guide.mp4"
SOURCE = ROOT / "public/onboarding-create-campaign.png"
WIDTH, HEIGHT, FPS, SECONDS = 1280, 720, 20, 15
RED = (239, 68, 68)
WHITE = (250, 250, 250)
MUTED = (171, 177, 189)
FONT_PATH = "/System/Library/Fonts/Supplemental/Arial.ttf"
BOLD_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def font(size, bold=False):
    return ImageFont.truetype(BOLD_PATH if bold else FONT_PATH, size)


def round_box(draw, box, fill, radius=18, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    map_image = Image.open(SOURCE).convert("RGB").resize((540, 724))
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg, "-y", "-f", "rawvideo", "-vcodec", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-", "-an",
        "-vcodec", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium",
        "-crf", "23", "-movflags", "+faststart", str(OUTPUT),
    ]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    assert encoder.stdin is not None

    points = [(792, 239), (1054, 341), (1165, 401), (1119, 504), (916, 551), (767, 487), (746, 354)]
    phases = [
        (0, 3, "1  Choose your area", "Your address places the map in your market."),
        (3, 8, "2  Draw the boundary", "Select Draw boundary. Click around the homes you want."),
        (8, 11, "3  Finish the shape", "Double-click the last point to finish your area."),
        (11, 15, "4  Create your map", "Check the home count, then create your 3D map."),
    ]

    for frame in range(FPS * SECONDS):
        seconds = frame / FPS
        image = Image.new("RGB", (WIDTH, HEIGHT), (8, 10, 15))
        image.paste(map_image, (718, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, 718, HEIGHT), fill=(9, 12, 18))
        draw.rectangle((718, 0, WIDTH, HEIGHT), outline=(55, 59, 68), width=2)
        round_box(draw, (58, 54, 264, 90), (69, 21, 26), radius=17)
        draw.text((76, 63), "WOLFGRID GUIDE", font=font(17, True), fill=(255, 133, 133))
        draw.text((58, 132), "Build your first", font=font(51, True), fill=WHITE)
        draw.text((58, 190), "campaign", font=font(51, True), fill=WHITE)
        draw.text((60, 273), "Watch once. Then draw in your own territory.", font=font(24), fill=MUTED)

        phase = next(item for item in phases if item[0] <= seconds < item[1])
        round_box(draw, (58, 351, 665, 488), (24, 29, 38), radius=24, outline=(62, 69, 81), width=2)
        draw.text((87, 374), phase[2], font=font(31, True), fill=WHITE)
        draw.text((87, 430), phase[3], font=font(18), fill=MUTED)

        for index in range(4):
            x = 58 + index * 154
            round_box(draw, (x, 590, x + 137, 598), RED if seconds >= phases[index][0] else (62, 68, 79), radius=4)
        draw.text((58, 617), "Choose area   •   Draw   •   Double-click   •   Create", font=font(18), fill=MUTED)

        if seconds >= 3:
            visible_segments = min(len(points) - 1, max(0, math.floor((seconds - 3) * 1.5)))
            if visible_segments:
                draw.line(points[:visible_segments + 1], fill=WHITE, width=7, joint="curve")
            for x, y in points[:visible_segments + 1]:
                draw.ellipse((x - 9, y - 9, x + 9, y + 9), fill=RED, outline=WHITE, width=3)
            if seconds >= 8:
                draw.line([points[-1], points[0]], fill=WHITE, width=7)
                round_box(draw, (830, 37, 1139, 93), (20, 28, 29), radius=17, outline=(41, 134, 88), width=2)
                draw.text((857, 55), "Homes selected: 24", font=font(23, True), fill=(142, 234, 178))
            if seconds >= 11:
                round_box(draw, (786, 615, 1176, 678), RED, radius=18)
                draw.text((808, 635), "Create 3D Prospecting Map  →", font=font(22, True), fill=WHITE)
        else:
            round_box(draw, (809, 40, 1138, 94), RED, radius=17)
            draw.text((839, 58), "Your selected market", font=font(22, True), fill=WHITE)

        encoder.stdin.write(image.tobytes())

    encoder.stdin.close()
    error = encoder.stderr.read().decode("utf-8", errors="replace") if encoder.stderr else ""
    if encoder.wait() != 0:
        raise RuntimeError(error[-3000:])
    print(f"Rendered {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
