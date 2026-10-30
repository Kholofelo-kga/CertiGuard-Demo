"""Generates the synthetic sample certificates used for the demo and the evaluation.
All people, numbers and institutions are fictional test data. Run: python3 tests/gen_samples.py"""
import json, random, io, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

random.seed(7); np.random.seed(7)
FD = "/usr/share/fonts/truetype/dejavu/"
F = lambda n, s: ImageFont.truetype(FD + n, s)
W, H = 1400, 990
MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"]
def long_date(iso):
    y, m, d = map(int, iso.split("-")); return f"{d} {MONTHS[m-1]} {y}"

def centre(dr, y, text, font, fill=(25, 25, 25)):
    w = dr.textlength(text, font=font); dr.text(((W - w) / 2, y), text, font=font, fill=fill)

PAPER = (252, 249, 240)
def base(c):
    img = Image.new("RGB", (W, H), PAPER); dr = ImageDraw.Draw(img)
    dr.rectangle([30, 30, W - 30, H - 30], outline=(20, 50, 110), width=8)
    dr.rectangle([52, 52, W - 52, H - 52], outline=(20, 50, 110), width=2)
    centre(dr, 95, c["institution"].upper(), F("DejaVuSerif-Bold.ttf", 46), (20, 50, 110))
    centre(dr, 175, "ACADEMIC CERTIFICATE", F("DejaVuSans.ttf", 26), (90, 90, 90))
    centre(dr, 285, "This is to certify that", F("DejaVuSerif.ttf", 30))
    centre(dr, 345, c["name"], F("DejaVuSerif-Bold.ttf", 56))
    centre(dr, 450, "has been awarded the", F("DejaVuSerif.ttf", 30))
    centre(dr, 510, c["qualification"], F("DejaVuSerif-Bold.ttf", 40))
    dr.text((130, 700), "Certificate No: " + c["number"], font=F("DejaVuSans.ttf", 30), fill=(25, 25, 25))
    dr.text((130, 760), "Date of issue: " + long_date(c["date"]), font=F("DejaVuSans.ttf", 30), fill=(25, 25, 25))
    dr.line([950, 830, 1250, 830], fill=(25, 25, 25), width=2); dr.text((1010, 840), "Registrar", font=F("DejaVuSans.ttf", 24), fill=(60, 60, 60))
    dr.ellipse([1020, 640, 1180, 800], outline=(150, 20, 20), width=5); dr.ellipse([1034, 654, 1166, 786], outline=(150, 20, 20), width=2)
    dr.text((1062, 700), "SEAL", font=F("DejaVuSans-Bold.ttf", 28), fill=(150, 20, 20))
    arr = np.asarray(img).astype(np.float32) + np.random.normal(0, 2.5, (H, W, 3))  # scanner noise
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

def jpeg(img, q):
    b = io.BytesIO(); img.save(b, "JPEG", quality=q); b.seek(0); return Image.open(b).convert("RGB")

def tamper(img, c, kind):
    """Edit the decoded JPEG (as an image editor would) and save again -> edited area has a different compression history."""
    img = img.copy(); dr = ImageDraw.Draw(img)
    if kind == "date":
        dr.rectangle([125, 755, 760, 805], fill=PAPER)
        dr.text((130, 760), "Date of issue: " + long_date(c["fake_date"]), font=F("DejaVuSans.ttf", 30), fill=(25, 25, 25))
    elif kind == "name":
        dr.rectangle([200, 335, W - 200, 420], fill=PAPER); centre(dr, 345, c["fake_name"], F("DejaVuSerif-Bold.ttf", 56))
    else:
        dr.rectangle([150, 500, W - 150, 570], fill=PAPER); centre(dr, 510, c["fake_qual"], F("DejaVuSerif-Bold.ttf", 40))
    return img

SEED = [
 ("TUT-2026-10482","Lerato Mokoena","Diploma in Information Technology","Tshwane University of Technology","2026-05-15"),
 ("UL-2025-77821","Thando Ndlovu","Bachelor of Information Science","University of Limpopo","2025-12-10"),
 ("UJ-2024-33105","Sipho Dlamini","BSc Computer Science","University of Johannesburg","2024-12-12"),
 ("WITS-2023-55012","Naledi Khumalo","BCom Accounting","University of the Witwatersrand","2023-12-08"),
 ("UP-2025-90417","Pieter van Wyk","Bachelor of Engineering Electrical","University of Pretoria","2025-12-11"),
]
UNKNOWN = [
 ("KTI-2025-20931","Zanele Mahlangu","Diploma in Business Management","Karoo Technical Institute","2025-07-18"),
 ("MCU-2024-41277","Kagiso Sithole","BA Communication Studies","Marula Coastal University","2024-04-26"),
 ("NLC-2026-60418","Ayanda Zulu","Higher Certificate in Accounting","Northern Lights College","2026-02-13"),
 ("DVU-2023-18862","Johan Botha","Bachelor of Education","Drakensberg Valley University","2023-11-30"),
 ("SRI-2025-73350","Fatima Patel","Diploma in Civil Engineering","Southern Ridge Institute","2025-09-05"),
]
FAKE_DATE = ["2025-05-15","2024-12-10","2023-12-12","2022-12-08","2024-12-11","2024-07-18","2023-04-26","2025-02-13","2022-11-30","2024-09-05"]
FAKE_NAME = ["Lebo Mokoena","Themba Ndlovu","Sipho Dlamini Jr","Naledi Khumalo-Smith","Pieter van Wyk Jr","Zanele Mahlangu Jr","Kagiso Sithole Jr","Ayanda Zulu Jr","Johan Botha Jr","Fatima Patel Jr"]
FAKE_QUAL = ["Advanced Diploma in Information Technology","Master of Information Science","MSc Computer Science","BCom Honours Accounting","Master of Engineering Electrical","Advanced Diploma in Business Management","MA Communication Studies","Diploma in Accounting and Finance","Master of Education","Advanced Diploma in Civil Engineering"]
KINDS = ["date","name","qual","date","name","qual","date","name","qual","date"]

people = SEED + UNKNOWN
truth = []
os.makedirs("tests/eval", exist_ok=True); os.makedirs("samples", exist_ok=True)
for i, (n, nm, q, inst, d) in enumerate(people):
    c = dict(number=n, name=nm, qualification=q, institution=inst, date=d, fake_date=FAKE_DATE[i], fake_name=FAKE_NAME[i], fake_qual=FAKE_QUAL[i])
    img = base(c)
    gen = jpeg(img, 85)                                   # genuine scan: compressed once
    gp = f"tests/eval/genuine_{i+1:02d}.jpg"; gen.save(gp, "JPEG", quality=85)
    truth.append(dict(file=gp, label="genuine", fields=dict(name=nm, number=n, qualification=q, institution=inst, date=d), seeded=i < 5))
    forged = tamper(gen, c, KINDS[i])                     # edited after first compression
    fp = f"tests/eval/tampered_{i+1:02d}.jpg"; forged.save(fp, "JPEG", quality=90)
    f2 = dict(name=nm, number=n, qualification=q, institution=inst, date=d)
    if KINDS[i] == "date": f2["date"] = FAKE_DATE[i]
    elif KINDS[i] == "name": f2["name"] = FAKE_NAME[i]
    else: f2["qualification"] = FAKE_QUAL[i]
    truth.append(dict(file=fp, label="tampered", edit=KINDS[i], fields=f2, seeded=i < 5))
json.dump(truth, open("tests/eval/truth.json", "w"), indent=1)

# demo samples (copies / variants of the evaluation material)
import shutil
shutil.copy("tests/eval/genuine_01.jpg", "samples/sample-1-genuine-TUT-2026-10482.jpg")
shutil.copy("tests/eval/tampered_02.jpg", "samples/sample-2-altered-name-UL-2025-77821.jpg")
shutil.copy("tests/eval/genuine_06.jpg", "samples/sample-3-unknown-institution-KTI-2025-20931.jpg")
Image.open("tests/eval/genuine_03.jpg").convert("RGB").save("samples/sample-4-genuine-UJ-2024-33105.pdf", "PDF", resolution=100)
print(len(truth), "evaluation images written")

# ---- degraded variants of the genuine certificates (robustness evaluation of OCR) ----
os.makedirs("tests/eval/degraded", exist_ok=True)
deg = []
for i in range(10):
    g = Image.open(f"tests/eval/genuine_{i+1:02d}.jpg").convert("RGB"); t = truth[i*2]
    v1 = g.filter(ImageFilter.GaussianBlur(1.6)); v1.save(f"tests/eval/degraded/blur_{i+1:02d}.jpg", "JPEG", quality=80)
    v2 = g.resize((int(W*.6), int(H*.6)), Image.BILINEAR); v2.save(f"tests/eval/degraded/lowres_{i+1:02d}.jpg", "JPEG", quality=35)
    v3 = g.rotate(2.5, resample=Image.BICUBIC, fillcolor=PAPER); v3.save(f"tests/eval/degraded/skew_{i+1:02d}.jpg", "JPEG", quality=80)
    for kind in ("blur", "lowres", "skew"):
        deg.append(dict(file=f"tests/eval/degraded/{kind}_{i+1:02d}.jpg", kind=kind, fields=t["fields"]))
json.dump(deg, open("tests/eval/degraded_truth.json", "w"), indent=1)
print(len(deg), "degraded images written")

# ---- document-type samples (not part of the accuracy evaluation) ----
def conference_cert():
    img = Image.new("RGB", (W, H), PAPER); dr = ImageDraw.Draw(img)
    dr.rectangle([30, 30, W - 30, H - 30], outline=(90, 20, 110), width=8)
    centre(dr, 110, "SOUTHERN AFRICA COMPUTING CONFERENCE 2026", F("DejaVuSerif-Bold.ttf", 40), (90, 20, 110))
    centre(dr, 200, "CERTIFICATE OF PARTICIPATION", F("DejaVuSans.ttf", 28), (90, 90, 90))
    centre(dr, 330, "This is to certify that", F("DejaVuSerif.ttf", 30))
    centre(dr, 390, "Mpho Radebe", F("DejaVuSerif-Bold.ttf", 56))
    centre(dr, 500, "attended and presented a paper at the conference", F("DejaVuSerif.ttf", 30))
    centre(dr, 560, "held in Pretoria on 12 September 2026", F("DejaVuSerif.ttf", 30))
    dr.line([950, 830, 1250, 830], fill=(25, 25, 25), width=2); dr.text((1010, 840), "Conference chair", font=F("DejaVuSans.ttf", 24), fill=(60, 60, 60))
    arr = np.asarray(img).astype(np.float32) + np.random.normal(0, 2.5, (H, W, 3)); return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
jpeg(conference_cert(), 85).save("samples/sample-5-conference-participation.jpg", "JPEG", quality=85)

def diploma_no_number():
    c = dict(number="", name="Busisiwe Nkosi", qualification="National Diploma in Nursing", institution="Eastern Cape Polytechnic", date="2025-11-21")
    img = base(dict(c, number="X")); dr = ImageDraw.Draw(img)
    dr.rectangle([125, 695, 760, 745], fill=PAPER)   # no certificate number is printed on this document
    arr = np.asarray(img).astype(np.float32) + np.random.normal(0, 1.5, (H, W, 3)); return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
jpeg(diploma_no_number(), 85).save("samples/sample-6-academic-no-number.jpg", "JPEG", quality=85)
print("document-type samples written")

# ---- hard case: approximates a real scanned diploma layout (wrapped title, ALL-CAPS name, birth date, other identifiers, low resolution) ----
def hard_diploma():
    img = Image.new("RGB", (W, H), PAPER); dr = ImageDraw.Draw(img)
    dr.rectangle([30, 30, W - 30, H - 30], outline=(20, 90, 60), width=6)
    centre(dr, 90, "TSHWANE UNIVERSITY", F("DejaVuSerif-Bold.ttf", 44), (20, 90, 60))
    centre(dr, 150, "OF TECHNOLOGY", F("DejaVuSerif-Bold.ttf", 44), (20, 90, 60))
    centre(dr, 270, "This is to certify that", F("DejaVuSerif.ttf", 26))
    centre(dr, 320, "THABO MOKGOSI", F("DejaVuSerif-Bold.ttf", 44))
    dr.text((130, 410), "Identity number 219745761", font=F("DejaVuSans.ttf", 22), fill=(25, 25, 25))
    dr.text((130, 445), "Date of birth 2000-04-06", font=F("DejaVuSans.ttf", 22), fill=(25, 25, 25))
    centre(dr, 520, "has been awarded the", F("DejaVuSerif.ttf", 26))
    centre(dr, 575, "ADVANCED DIPLOMA", F("DejaVuSerif-Bold.ttf", 34))
    centre(dr, 625, "in Computer Science", F("DejaVuSerif-Bold.ttf", 30))
    dr.text((130, 760), "Date 13 December 2024", font=F("DejaVuSans.ttf", 22), fill=(25, 25, 25))
    dr.text((130, 800), "Ref AD12223", font=F("DejaVuSans.ttf", 20), fill=(25, 25, 25))
    dr.ellipse([1020, 640, 1180, 800], outline=(150, 20, 20), width=5); dr.text((1062, 700), "SEAL", font=F("DejaVuSans-Bold.ttf", 28), fill=(150, 20, 20))
    dr.rectangle([60, 60, 330, 120], outline=(200, 20, 20), width=3)   # red box that is NOT text
    arr = np.asarray(img).astype(np.float32) + np.random.normal(0, 3, (H, W, 3)); img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    return img.resize((int(W * 0.7), int(H * 0.7)), Image.LANCZOS)
jpeg(hard_diploma(), 60).save("tests/eval/hard_tut_style.jpg", "JPEG", quality=60)
print("hard-case sample written")
