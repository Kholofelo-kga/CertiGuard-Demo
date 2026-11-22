# Assignment 5 CNN retraining experiment (not adopted)

Goal: reach ETR-01 (accuracy >= 95%; precision, recall, F1 >= 94%) by training the same 116,369-parameter tile CNN
on more synthetic documents (1,500 instead of 900; 148,052 training tiles), for 10 epochs instead of 6, with flip and
contrast/brightness augmentation. Threshold chosen on the validation split only (0.9802).

Held-out synthetic test (1,011 images, institutions never seen in training), results.json:
accuracy 90.6%, precision 92.9%, recall 77.7%, F1 0.85, AUC 0.945; false alarms 0.4% on unedited scans,
4.2% on benign processing; logo-edit recall 6%, signature-edit recall 40%.

Browser run on the 20 independent evaluation files (tests/eval, made by a different generator), browser_test_run.json:
10/10 altered flagged but 4/10 genuine flagged (A4 model: 7/10 and 0/10); one genuine seeded certificate became Suspicious.

Decision: not deployed. ETR-01 is still not met, and the model raised more false alarms on documents from a different
generator, which is the risk that matters most for genuine graduates. The Assignment 4 model (ml/results.json) stays in use.

Reproduce: `python3 ml/a5_experiment/gen_ml.py 1500` (set ONLY=test to rebuild one split if memory is short),
then `python3 ml/a5_experiment/train.py` and `python3 ml/a5_experiment/export.py`, run from the project root.
