"""Synthetic training / evaluation data for the CertiGuard tamper-region CNN (fictional people and institutions).
Documents are split by INSTITUTION (train / validation / test never share an institution or a person).
Tiles of 64x64 px are cut from every image after resizing to 1400 px width; a tile is positive when it overlaps an edited box.
Run: python3 ml/gen_ml.py"""
import io, random, sys, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
from multiprocessing import Pool
FD = "/usr/share/fonts/truetype/dejavu/"; F = lambda n, s: ImageFont.truetype(FD + n, s)
W, H, T = 1400, 990, 64
FIRST = "Lerato Thando Sipho Naledi Pieter Zanele Kagiso Ayanda Johan Fatima Themba Lindiwe Bongani Nomsa Thabo Karabo Mpho Busisiwe Sizwe Palesa Andile Refilwe Tumelo Anele Ruan Annelise Yusuf Aisha Dineo Lwazi Nandi Jabu Kefilwe Neo Zodwa Hendrik Marike Imran Priya".split()
LAST = "Mokoena Ndlovu Dlamini Khumalo Wyk Mahlangu Sithole Zulu Botha Patel Nkosi Radebe Mthembu Molefe Naidoo Pretorius Venter Mabaso Tshabalala Maseko Ngcobo Smit Jacobs Moyo Chauke Baloyi Mazibuko Sibiya Coetzee Khan Peters Lekota Ramaphosa Mohlala Ledwaba Fourie Joubert Adams".split()
INST = ["Tshwane University of Technology","University of Limpopo","University of Johannesburg","University of the Witwatersrand","University of Pretoria","Karoo Technical Institute","Marula Coastal University","Northern Lights College","Drakensberg Valley University","Southern Ridge Institute","Highveld Polytechnic","Baobab Institute of Technology","Cape Winelands University","Free State Academy","Kalahari Technical College","Lowveld University","Garden Route Institute","Waterberg College","Eastern Cape Polytechnic","Zululand Institute of Science","Mpumalanga Technical University","Pondoland College","Namaqua Institute","Bushveld University"]
QUAL = ["Diploma in Information Technology","Bachelor of Information Science","BSc Computer Science","BCom Accounting","Bachelor of Engineering Electrical","Diploma in Business Management","BA Communication Studies","Higher Certificate in Accounting","Bachelor of Education","Diploma in Civil Engineering","National Diploma in Nursing","Advanced Diploma in Computer Science","MSc Computer Science","BCom Honours Accounting","Diploma in Public Management"]
MON = ["January","February","March","April","May","June","July","August","September","October","November","December"]
def jpeg(img, q):
    b = io.BytesIO(); img.save(b, "JPEG", quality=q); b.seek(0); return Image.open(b).convert("RGB")
def centre(dr, y, t, f, fill): w = dr.textlength(t, font=f); dr.text(((W - w) / 2, y), t, font=f, fill=fill)
def person(r): return r.choice(FIRST) + " " + r.choice(LAST)
def base(c, r):
    paper = tuple(int(v) for v in np.clip(np.array((252, 249, 240)) + np.array([r.randint(-8, 6), r.randint(-8, 6), r.randint(-14, 4)]), 215, 255))
    ink = (r.randint(10, 40),) * 3; col = (r.randint(10, 120), r.randint(20, 120), r.randint(40, 140))
    img = Image.new("RGB", (W, H), paper); dr = ImageDraw.Draw(img)
    dr.rectangle([30, 30, W - 30, H - 30], outline=col, width=r.randint(4, 9)); dr.rectangle([52, 52, W - 52, H - 52], outline=col, width=2)
    j = lambda s: s + r.randint(-3, 3); sf = r.choice(["DejaVuSerif.ttf", "DejaVuSans.ttf"]); sb = sf.replace(".ttf", "-Bold.ttf")
    centre(dr, 95, c["inst"].upper(), F("DejaVuSerif-Bold.ttf", j(44)), col); centre(dr, 175, r.choice(["ACADEMIC CERTIFICATE", "CERTIFICATE OF QUALIFICATION", "DEGREE CERTIFICATE"]), F("DejaVuSans.ttf", 26), (90, 90, 90))
    centre(dr, 285, "This is to certify that", F(sf, j(30)), ink); centre(dr, 345, c["name"], F(sb, j(56)), ink)
    centre(dr, 450, "has been awarded the", F(sf, j(30)), ink); centre(dr, 510, c["qual"], F(sb, j(40)), ink)
    dr.text((130, 700), "Certificate No: " + c["num"], font=F("DejaVuSans.ttf", 30), fill=ink); dr.text((130, 760), "Date of issue: " + c["date"], font=F("DejaVuSans.ttf", 30), fill=ink)
    dr.ellipse([1020, 640, 1180, 800], outline=(150, 20, 20), width=5)
    logo(dr, r, col); scribble(dr, r)
    return img, paper
def logo(dr, r, col):
    k = r.randint(0, 2); x0, y0 = 75, 70
    if k == 0: dr.ellipse([x0, y0, x0 + 130, y0 + 130], outline=col, width=8); dr.polygon([(x0 + 65, y0 + 25), (x0 + 105, y0 + 100), (x0 + 25, y0 + 100)], fill=col)
    elif k == 1: dr.rectangle([x0, y0, x0 + 130, y0 + 130], outline=col, width=8); dr.line([x0, y0, x0 + 130, y0 + 130], fill=col, width=8)
    else: dr.pieslice([x0, y0, x0 + 130, y0 + 130], 30, 300, fill=col)
def scribble(dr, r):
    x = 960; pts = []
    for i in range(14): pts.append((x + i * 22 + r.randint(-4, 4), 800 + r.randint(-26, 26)))
    dr.line(pts, fill=(20, 20, 90), width=3)
def noisy(img, sig, r):
    a = np.asarray(img).astype(np.float32) + np.random.normal(0, sig, (img.height, img.width, 3)); return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
def make_doc(args):
    seed, inst, split = args; r = random.Random(seed); np.random.seed(seed % (2**31))
    d = dict(inst=inst, name=person(r), qual=r.choice(QUAL), num="%s-%d-%05d" % ("".join(w[0] for w in inst.split() if w[0].isupper())[:4], r.randint(2022, 2026), r.randint(1000, 99999)), date="%d %s %d" % (r.randint(1, 28), r.choice(MON), r.randint(2022, 2026)))
    sig = r.uniform(1.0, 5.0); img, paper = base(d, r); img = noisy(img, sig, r); q1 = r.randint(70, 92); gen = jpeg(img, q1)
    # tampering: edit the decoded JPEG, save again (different compression history); boxes list the edited areas
    kind = r.choice(["text_name", "text_date", "text_qual", "copy_paste", "local_blur", "logo_edit", "signature_edit", "seal_edit"]); t = gen.copy(); dr = ImageDraw.Draw(t); boxes = []
    ink = (25, 25, 25); fillpaper = tuple(int(v) for v in np.asarray(gen.crop((60, 880, 160, 920))).reshape(-1, 3).mean(0))
    if kind == "text_name": b = [200, 335, W - 200, 420]; dr.rectangle(b, fill=fillpaper); centre(dr, 345, person(r), F("DejaVuSerif-Bold.ttf", 56), ink)
    elif kind == "text_date": b = [125, 755, 760, 805]; dr.rectangle(b, fill=fillpaper); dr.text((130, 760), "Date of issue: %d %s %d" % (r.randint(1, 28), r.choice(MON), r.randint(2018, 2025)), font=F("DejaVuSans.ttf", 30), fill=ink)
    elif kind == "text_qual": b = [150, 500, W - 150, 570]; dr.rectangle(b, fill=fillpaper); centre(dr, 510, r.choice(QUAL), F("DejaVuSerif-Bold.ttf", 40), ink)
    elif kind == "copy_paste":
        b = [200, 335, W - 200, 420]; src = gen.crop((200, 500, W - 200, 585)); t.paste(src, (200, 335))
    elif kind == "logo_edit":
        b = [60, 55, 225, 215]; dr.rectangle(b, fill=fillpaper); logo(dr, r, (r.randint(10, 120), r.randint(20, 120), r.randint(40, 140)))
    elif kind == "signature_edit":
        b = [940, 760, 1280, 845]; dr.rectangle(b, fill=fillpaper); scribble(dr, r)
    elif kind == "seal_edit":
        b = [1005, 625, 1195, 815]; dr.rectangle(b, fill=fillpaper); dr.ellipse([1020, 640, 1180, 800], outline=(150, 20, 20), width=5); dr.text((1062, 700), "SEAL", font=F("DejaVuSans-Bold.ttf", 28), fill=(150, 20, 20))
    else:
        b = [130, 690, 760, 800]; reg = t.crop(tuple(b)).filter(ImageFilter.GaussianBlur(r.uniform(1.2, 2.2))); t.paste(reg, (130, 690))
    if kind.startswith(("text", "logo", "signature", "seal")) and r.random() < 0.5:   # attacker adds matching scanner noise to the edited box
        reg = noisy(t.crop(tuple(b)), sig, r); t.paste(reg, (b[0], b[1]))
    boxes.append(b); forged = jpeg(t, r.randint(75, 95))
    def process(im, op):
        if op == "resave": return jpeg(im, r.randint(60, 90))
        if op == "resize": s = r.uniform(0.7, 0.95); return jpeg(im.resize((int(W * s), int(H * s)), Image.LANCZOS), r.randint(70, 90))
        if op == "blur": return jpeg(im.filter(ImageFilter.GaussianBlur(r.uniform(0.5, 1.0))), r.randint(70, 90))
        if op == "bright": return jpeg(ImageEnhance.Contrast(ImageEnhance.Brightness(im).enhance(r.uniform(0.85, 1.1))).enhance(r.uniform(0.85, 1.1)), r.randint(70, 90))
        return jpeg(im.rotate(r.uniform(-1.2, 1.2), resample=Image.BICUBIC, fillcolor=paper), r.randint(70, 90))
    ops = ["resave", "resize", "blur", "bright", "rotate"]; op1, op2 = r.sample(ops, 2)
    items = [(0, gen, [], "genuine"), (1, forged, boxes, kind), (0, process(gen, op1), [], "benign_" + op1), (0, process(gen, op2), [], "benign_" + op2)]
    if r.random() < 0.5:   # forged page then scanned again / resized: the edit is still there
        fop = r.choice(["resave", "resize", "blur", "bright"]); items.append((1, process(forged, fop), boxes, kind))
    out = []
    for lab, im, bx, tag in items:
        im = im.convert("L").resize((W, H), Image.BILINEAR) if im.size != (W, H) else im.convert("L"); a = np.asarray(im, dtype=np.uint8)
        tiles, labs = [], []
        for y in range(0, H - T + 1, T):
            for x in range(0, W - T + 1, T):
                ov = 0
                for b in bx: ox = max(0, min(x + T, b[2]) - max(x, b[0])); oy = max(0, min(y + T, b[3]) - max(y, b[1])); ov = max(ov, ox * oy / (T * T))
                tiles.append(a[y:y + T, x:x + T]); labs.append(1 if ov >= 0.25 else 0)
        tl = np.array(labs, dtype=np.uint8); tt = np.stack(tiles)
        if split == "train":   # keep memory small: sample tiles inside the worker (all positives + 2x random negatives)
            pos = np.where(tl == 1)[0]; neg = np.where(tl == 0)[0]; rs = np.random.RandomState(seed % 100000)
            kn = rs.choice(neg, size=min(len(neg), max(20, 2 * len(pos))), replace=False); idx = np.r_[pos, kn].astype(int)
            out.append(dict(X=tt[idx], Y=tl[idx]))
        else: out.append(dict(img_label=lab, tag=tag, tiles=tt, tlabels=tl))
    return split, seed, out
if __name__ == "__main__":
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 600
    ins = INST[:]; random.Random(1).shuffle(ins); sp = {"train": ins[:16], "val": ins[16:20], "test": ins[20:]}
    jobs = []; per = {"train": int(N * 0.7), "val": int(N * 0.15), "test": N - int(N * 0.7) - int(N * 0.15)}
    for s, k in per.items():
        for i in range(k): jobs.append((hash((s, i)) % 100000 + (1000 if s == "train" else 2000 if s == "val" else 3000) * 100, sp[s][i % len(sp[s])], s))
    # make seeds unique and deterministic
    jobs = [(i * 7919 + 13, j[1], j[2]) for i, j in enumerate(jobs)]
    store = {"train": [], "val": [], "test": []}
    with Pool(2) as p:
        for k, (s, seed, out) in enumerate(p.imap_unordered(make_doc, jobs, chunksize=4)):
            store[s].append(out)
            if k % 50 == 0: print(k, "/", len(jobs), flush=True)
    rng = np.random.RandomState(0)
    for s in store:
        if s == "train":   # tile-level training set: all positives, random negatives (3 per positive), taken from genuine/benign/forged images
            X = np.concatenate([im["X"] for out in store[s] for im in out]); Y = np.concatenate([im["Y"] for out in store[s] for im in out])
            np.savez_compressed("ml/train_tiles.npz", X=X, Y=Y); print("train tiles", len(Y), "positives", int(Y.astype(int).sum()))
        else:
            tiles = np.stack([im["tiles"] for out in store[s] for im in out]); lab = np.array([im["img_label"] for out in store[s] for im in out]); tl = np.stack([im["tlabels"] for out in store[s] for im in out]); tag = np.array([im["tag"] for out in store[s] for im in out])
            np.savez_compressed(f"ml/{s}_images.npz", tiles=tiles, img_label=lab, tlabels=tl, tag=tag); print(s, tiles.shape, lab.mean())
