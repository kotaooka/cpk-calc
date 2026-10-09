# scipy・pandas で参照値を作り tests/reference.json に書き出す
#   pip install numpy scipy pandas
#   python tests/make_reference.py
# 工程能力指数は CpkTools-WebUI の capability.py と同じ定義を、numpy で独立に書いて求める
import json, math
from pathlib import Path
import numpy as np, pandas as pd
from scipy import stats

rng = np.random.default_rng(20261009)
R = {}

# ---- 分布関数 ----
R['norm'] = [dict(x=x, cdf=stats.norm.cdf(x), sf=stats.norm.sf(x), pdf=stats.norm.pdf(x)) for x in
             [-8, -5, -3, -1.96, -0.5, 0, 0.3, 1, 2.5, 3, 4.5, 6]]
R['normppf'] = [dict(p=p, v=stats.norm.ppf(p)) for p in [1e-12, 1e-6, 0.001, 0.025, 0.1, 0.3, 0.5, 0.7, 0.975, 0.999, 1 - 1e-9]]
R['chi2'] = [dict(x=x, k=k, cdf=stats.chi2.cdf(x, k)) for x, k in [(0.5, 1), (3, 2), (10, 5), (20, 29), (100, 99), (5, 30)]]
R['chi2ppf'] = [dict(p=p, k=k, v=stats.chi2.ppf(p, k)) for p, k in [(0.025, 29), (0.975, 29), (0.025, 1), (0.975, 4), (0.5, 100), (0.025, 2), (0.995, 499)]]
R['t'] = [dict(t=t, df=df, cdf=stats.t.cdf(t, df), pdf=stats.t.pdf(t, df)) for t, df in
          [(-3, 2), (0.5, 5), (2.1, 9.37), (1.96, 1000), (-0.2, 1), (4, 28.5)]]
R['tppf'] = [dict(p=p, df=df, v=stats.t.ppf(p, df)) for p, df in [(0.975, 5), (0.001, 9.37), (0.999, 3), (0.6, 40)]]
R['f'] = [dict(f=f, d1=a, d2=b, sf=stats.f.sf(f, a, b), pdf=stats.f.pdf(f, a, b)) for f, a, b in
          [(1.5, 9, 9), (3.2, 4, 20), (0.8, 29, 14), (12, 2, 3), (1.01, 99, 99)]]
R['fppf'] = [dict(p=p, d1=a, d2=b, v=stats.f.ppf(p, a, b)) for p, a, b in [(0.001, 9, 9), (0.999, 4, 20), (0.5, 29, 14)]]

# ---- 記述統計・Shapiro-Wilk ----
sets = {}
for n in [3, 4, 5, 6, 7, 11, 12, 20, 30, 50, 137, 500, 2000]:
    sets[f'norm{n}'] = rng.normal(10, 2, n)
sets['skew200'] = rng.lognormal(0, 0.6, 200)
sets['unif60'] = rng.uniform(0, 1, 60)
sets['ties25'] = np.round(rng.normal(0, 1, 25), 1)
R['desc'] = []
for name, x in sets.items():
    s = pd.Series(x)
    W, p = stats.shapiro(x)
    R['desc'].append(dict(name=name, x=list(map(float, x)), mean=float(s.mean()), sd=float(s.std()), skew=float(s.skew()),
                          kurt=float(s.kurt()) if len(x) >= 4 else None, W=float(W), p=float(p)))

# ---- 2群の検定・相関 ----
a = rng.normal(10, 1, 25); b = rng.normal(10.6, 1.6, 31); c = a + rng.normal(0.3, 0.5, 25)
v1, v2 = np.var(a, ddof=1), np.var(b, ddof=1)
F = max(v1, v2) / min(v1, v2); dfn, dfd = (24, 30) if v1 >= v2 else (30, 24)
R['tests'] = dict(a=list(map(float, a)), b=list(map(float, b)), c=list(map(float, c)),
                  F=F, dfn=dfn, dfd=dfd, pF=2 * stats.f.sf(F, dfn, dfd),
                  pooled=list(stats.ttest_ind(a, b, equal_var=True)), welch=list(stats.ttest_ind(a, b, equal_var=False)),
                  paired=list(stats.ttest_rel(a, c)), r=float(np.corrcoef(a, c)[0, 1]), fit=list(np.polyfit(a, c, 1)))

# ---- 工程能力指数（capability.py と同じ定義を独立に実装） ----
D2 = {2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078}
def cap(x, usl, lsl, m, ddof):
    n = len(x); mu = x.mean(); s = x.std(ddof=ddof)
    if m == 1: sw = np.abs(np.diff(x)).mean() / D2[2]
    else:
        k = n // m; g = x[:k * m].reshape(k, m); sw = (g.max(1) - g.min(1)).mean() / D2[m]
    def ind(sig):
        up = (usl - mu) / (3 * sig) if usl is not None else None
        lo = (mu - lsl) / (3 * sig) if lsl is not None else None
        both = usl is not None and lsl is not None
        return ((usl - lsl) / (6 * sig) if both else None, min(v for v in (up, lo) if v is not None))
    (Cp, Cpk), (Pp, Ppk) = ind(sw), ind(s)
    z = stats.norm.ppf(0.975)
    se = math.sqrt(1 / (9 * n * Ppk ** 2) + 1 / (2 * (n - 1)))
    ci = sorted([Ppk * (1 - z * se), Ppk * (1 + z * se)])
    ppci = [Pp * math.sqrt(stats.chi2.ppf(0.025, n - 1) / (n - 1)), Pp * math.sqrt(stats.chi2.ppf(0.975, n - 1) / (n - 1))] if Pp else [None, None]
    return dict(sw=sw, s=s, Cp=Cp, Cpk=Cpk, Pp=Pp, Ppk=Ppk, PpkCI=ci, PpCI=ppci)
x = 10 + rng.normal(0, 0.02, 103) + np.where((np.arange(103) // 5) % 2, 0.01, 0)
R['cap'] = []
for m in (1, 2, 3, 5, 8, 10):
    for usl, lsl in ((10.08, 9.94), (10.08, None), (None, 9.94)):
        for ddof in (1, 0):
            R['cap'].append(dict(m=m, usl=usl, lsl=lsl, ddof=ddof, **cap(x, usl, lsl, m, ddof)))
R['capx'] = list(map(float, x))

def clean(o):
    if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)): return float(o)
    if isinstance(o, np.integer): return int(o)
    return o
(Path(__file__).parent / 'reference.json').write_text(json.dumps(clean(R), ensure_ascii=False), encoding='utf-8', newline='\n')
print('参照値を書き出しました')
