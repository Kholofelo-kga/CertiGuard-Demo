"""Train the CertiGuard tamper-region CNN (small, trained from scratch, CPU) and evaluate it on held-out institutions."""
import numpy as np, torch, torch.nn as nn, json, time
from sklearn.metrics import roc_auc_score, precision_recall_fscore_support
torch.manual_seed(0); np.random.seed(0); torch.set_num_threads(2)
class Net(nn.Module):
    def __init__(s):
        super().__init__()
        def blk(i, o): return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(), nn.Conv2d(o, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(), nn.MaxPool2d(2))
        s.f = nn.Sequential(blk(1, 16), blk(16, 32), blk(32, 48), blk(48, 64)); s.h = nn.Linear(64, 1)
    def forward(s, x): x = (x - 0.5) * 4; return s.h(s.f(x).mean((2, 3))).squeeze(1)   # logit
if __name__ == "__main__":
    d = np.load("ml/train_tiles.npz"); X = torch.from_numpy(d["X"]).float().div(255).unsqueeze(1); Y = torch.tensor(d["Y"]).float()
    print("train tiles", len(Y), "positives", int(Y.sum().item()))
    net = Net(); opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4); EP = 6
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 4e-3, total_steps=EP * (len(Y) // 128 + 1))
    lossf = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(float((Y == 0).sum() / Y.sum()) ** 0.5))
    val = np.load("ml/val_images.npz", allow_pickle=True)
    def score_images(npz):
        t = npz["tiles"]; n = t.shape[0]; net.eval(); out = []
        with torch.no_grad():
            for i in range(n): out.append(torch.sigmoid(net(torch.from_numpy(t[i]).float().div(255).unsqueeze(1))).numpy())
        P = np.stack(out); top = np.sort(P, 1)[:, -3:].mean(1); return P, top
    best = (-1, None)
    for ep in range(EP):
        net.train(); perm = torch.randperm(len(Y)); tl = 0; t0 = time.time()
        for i in range(0, len(Y), 128):
            idx = perm[i:i + 128]; xb = X[idx]; 
            xb = xb + torch.randn_like(xb) * 0.004 * torch.rand(len(idx), 1, 1, 1)   # mild noise augmentation
            opt.zero_grad(); l = lossf(net(xb), Y[idx]); l.backward(); opt.step(); sched.step(); tl += l.item() * len(idx)
        P, top = score_images(val); auc = roc_auc_score(val["img_label"], top)
        print(f"epoch {ep+1}/{EP} loss {tl/len(Y):.4f} val image AUC {auc:.3f} ({time.time()-t0:.0f}s)", flush=True)
        if auc > best[0]: best = (auc, {k: v.clone() for k, v in net.state_dict().items()})
    net.load_state_dict(best[1]); torch.save(net.state_dict(), "ml/tamper_cnn.pt")
    # threshold from VALIDATION only: the value that maximises F1 on the validation images
    P, top = score_images(val); neg = top[val["img_label"] == 0]; yv = val["img_label"]; cands = np.unique(np.round(top, 4)); f1s = []
    for c in cands:
        pr = (top >= c).astype(int); tp = ((pr == 1) & (yv == 1)).sum(); fp = ((pr == 1) & (yv == 0)).sum(); fn = ((pr == 0) & (yv == 1)).sum(); f1s.append(2 * tp / max(1, 2 * tp + fp + fn))
    thr = float(cands[int(np.argmax(f1s))]); print("threshold (max validation F1)", thr)
    # ---- held-out test ----
    te = np.load("ml/test_images.npz", allow_pickle=True); Pt, topt = score_images(te); y = te["img_label"]; tag = te["tag"]
    pred = (topt >= thr).astype(int); p, r, f1, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
    res = dict(threshold=thr, n_test=int(len(y)), accuracy=float((pred == y).mean()), precision=float(p), recall=float(r), f1=float(f1), auc=float(roc_auc_score(y, topt)),
        fpr_genuine=float(pred[tag == "genuine"].mean()), fpr_benign=float(pred[np.char.startswith(tag.astype(str), "benign")].mean()),
        recall_by_type={t: float(pred[tag == t].mean()) for t in sorted(set(tag.astype(str))) if not t.startswith(("benign", "genuine"))},
        fpr_by_benign={t: float(pred[tag == t].mean()) for t in sorted(set(tag.astype(str))) if t.startswith("benign")},
        auc_by_type={t: float(roc_auc_score(np.r_[np.zeros((tag == "genuine").sum()), np.ones((tag == t).sum())], np.r_[topt[tag == "genuine"], topt[tag == t]])) for t in sorted(set(tag.astype(str))) if not t.startswith(("benign", "genuine"))},
        # does the highest-scoring tile fall inside the edited region?
        localisation=float(np.mean([te["tlabels"][i][Pt[i].argmax()] for i in range(len(y)) if y[i] == 1])),
        params=int(sum(p.numel() for p in net.parameters())), train_tiles=int(len(Y)))
    json.dump(res, open("ml/results.json", "w"), indent=1); print(json.dumps(res, indent=1))
