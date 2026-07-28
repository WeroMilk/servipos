/**
 * Actualiza MUEBLE_POR_SLOT en ubicacionesMuebleA.ts con la lista de muebles/SKU.
 * H y H1 = todos los productos con "suspensión/suspension" en el nombre (catálogo).
 * Conserva BANDAS, Mostrador, Cajonera y slots no mencionados en la lista.
 */
import fs from 'node:fs';

const PATH = 'src/data/ubicacionesMuebleA.ts';
const CATALOG = 'exports/productos-catalogo.json';

/** Lista del usuario (slot en minúsculas → códigos). */
const RAW = `
a
W910010062
W10759993
W11104317
1033
1433
606
606
2014
560
WW01F00043
505
1474

a1
W11413545
2134
3957849
1964
1963
1282
1482
1396
799
2275
800
1767
801
1700
1948
189
869
3966894

a2
2291
2109
EAU64283201
1251
1137
1067
890
1430
1982
1051
631
DW1707

a3
226
2095
W11198451
1438
2109
32
1133
W11198451
1398
1395
2145

a4
632
7503033971338
972
60

b
1279
1228
898
203
2106
1468
108
1675
1998
1544
1099

b1
1091
1372
7503033971253
1567
394
394
67

b2
W10465543
1164
1394
2088
120
120

b3
1352
1026
880
1915

b4
43
7503033971215
1983
350365

c
407
1355
47
47
2273
WP21002022

c1
5304490556
12002022
131525500
134509510
1621
1804
1500
1569
952
1542
917
1768
18
2251

c2
1803
1996
603
1970
1134
1135
1624
DC97-21487D
1427
315
1882
107
2284
1592
1592
2288
2283

c3
1885
2223
4907
1170
2223
2282
2223

c4
W10677715
W10677715
W10623547
W10623547
4265EY1003P

d

d1
1173
1003
1003

d2
1115
1115
1115
1358
1357

d3
30
30
170
1906

d4
2326
1174
1174
2133

d5
169
1174
1174
1174

d6
1003
831

e

e1
WW01F00357
8057755
W910010096

e2
169
1906
TRLAWH004
TRLAWH004

e3
171
171
30
1506

e4
2204
2047

e5

e6
1757
167

f
1453

f1
2306

f2
3934469
W910010088
883049283234

f3
285352

f4
1640
285352

f5
389140
2132

f6

f7
8546462
389140

f8

g1
216
640

g2
103
150
197
80
81
113
W10006371

g3
508

g4

g5

i
1341
1988
2203
2203

i1

i2
1987
1987
1987

j1
748
2314
1978
871

j2
W11518677
W11518673
W11518672
1225
FOLAMB004
W11518680
WP21002022

j3
WW03F00506
233D2306G002
1449
1073
817
814

j4
2025

k1
1335
1561
247
206
1024

l1
WPW10178988
1125
1128
2181
1123
1124
2237
1283
1160
104
1122
1126
1127
131763302
1668
W11195059
2218
1839
1475
1464
1472
1533
1463
1462
1452
633
1724
1944
W10734521
1212
8537434
2315
873
879
1460
2011
285811
285809
8055142
899
16400795
W10250667
1841
1699
980
1723

l2
X002GA1719
2262
1763
W10153867
1677
2169
2169
WP8183270
134101800E
1447

l3
178
174
1447
1783
1577
59
DW1704
302421670010
26
2217
1785
930
1793

l4
172
176
1036
177
175
173
199
1461
7122105
2155
69
69

l5
309882
1950
947
1246
2147
69
70
74

m1
W10443885
2167
131763255
W10547392
DC64-00519D-E
1774
1773
1451
1450
1601
1059

m2
1100
965
1840
1836
2081
1020
1057
W910010004

m3
225
2267
10055
K-65859

m4
40802
1092
1758
2132
2132
963
1677
19

m5
W11176112
962
137353302
137353302
1321
1323
1451
1489
1549
1373
1256
W11179275
1381

n1
15
2254
1019
50946009865
WE4M416
192
932
7503026192573

ñ1
1764
1535
1017
1582
279962
2037
279570
1353
189D7089P003
189D7089P016
1325
1294
1494
1172
135
2019
2018
WPW10549553
1563
294
306508
1441
1896
1897
2017
137513300

ñ2
1163
7503026414422
2192
1912
1054
WP691366
1437
893
1756
1354
1131
5303212849
1190

ñ3
1709
1083
883049433936
349241T
2156
1224
X002V2NXLJ
1470
1148
1702
1701
1039
1239
134711300
1387
2157
1110
819
1111
1109
909
1113
1112
1114
5304406099
1976
797

ñ4
279827
1473
1669
1662
1595
908

ñ5
2292
2292
2292
131775600

o1
279838
WP4391960
2198
601
2189
144444
1869
5303937139P
280114
248
239087
W11035878

o2
746
744
745
078477905739
078477695302
078477905753
745
1989
1248
686590
686590

o3
2319
1625
1632
1980
1760
1681
2194
870
1230
1801
1496
5300622032

o4
1708
1977

o5
2261
131476309
1585
1277
1277
1183

p1
2323
2328
1695
403

p2
W10587906
1909
1719
1588
1589
1590
1591
1587
2266

p3
953
2265
96
1794
95

p4
1794
1794

p5
50946009865
WP3390719

q1
7503026192535
2008
1930
1939
1926
1927
1940
1935
1942
1941
1924
1925
1936

q2
2210
2211
1563
2302
2207
2230
2206

q3
1597
1598
2215
2216
1645
2119
2118

q4
1294
279834V

q5

r1
2153
2152
2151
2150
2154
1798
40801

s1
1132
1761
1781
708
1286
1199
2255
98148962
1098

t1
2341
2286
1380
1379

t2
7491
2086
701
1981

t3
7503053083370
W11466252
1656
141
891
207
143
142

t4
2094
7503026195567
23
7503026192504
285
1309
2198202E
1229
7503028596423
1350
1497
1448
296
915
1193

t5
299
500

u
2036
260

u1
1706
1707

u2
2305
2305
2304
2303
1106
1094
1242
1130
1484
1487
1603
926
7503026191835
2287
2226
2225
1972
1766
1119
1121
1118
1129

u3
1241
1483
1486
1485
7503026196861
7503026191842
628
1649
1650
W11396033

u4
W10790814
W10790814
7503026203521
883049383729
883049383712
7503026191835
7503026203477
51200
RA0036
1446
2035
2034

u5
1367
152
1220
1872
1219
7503026203637

u6
1422
401
7503026195147

v1
7503026191262
7503026191217
7503026191224
7503026191231
7503026191248
7503026191255
1116
978
977
941
940
939
938
W11503892
7503026191064
7503026191071
7503026191088
7503026191095
7503026191101
7503026191118
1082
7503026191279
7503026191316
7503026191309
7503026191293
7503026191286
619
1081
521
166
165
7503026177181
7503026177259
7503026177211
7503026177181
7503026177167
1080
7503026177235
7503026177174
WR01F00099

v2
W11410542
928
927
2231
1605
6871JK1005
180
931
918
1602
2149
1197
1200
1171
1198
W11436572

v3
1102
2084
1492
1232
1250
WR01F00288

v4
5304531506
1249
1249
1181
51200
SAMREF01

w1
1050
1181
239D5453G001
32132
32132

w2
1361
W10236142
1344
1105
1705
7503028596454
1370
2276
1866
1898
7503026192399
1221
2281
219
2090
1408
1084

w3
1338
1222
1136
2295
2294
9741
144
1957
1107
2232
EAU65089706
1876
1715
1714

w4
1402
7503044381683
1545

zz
2299
N21Q33K687
EMC3140U
2298
2137

aa1
2260
2260
2301
2260
2301

aa2
1440

aa3
2348

aa4
2163
2104
1918

bb1
1064
7503026414866
1064
254
256
7503026178805
920
1002

bb2
037103570192
503

bb3

cc
970
7503026414996
7503026414989
891
852
848
853
849

cc1
7503026414583
7503026414590
253

cc2
187
2300
1194
1194
1194
1194

dd
969
968
967
966
970
7503026196847
7503026196830
7503026191576
7503026191040
7503026196731
7503026196748
153
154
218
1062
1917
138
186
185

dd1
850
851
123

dd2
7503026178836

dd3

dd4
1979
1979
1726
2259

ee
944
2244
316
876
877
2245
2244
39
38
37
99
34
35
31
854

ee1
2138
1365
314
49
50
51
855
999
507

ee2
2092
844
687152222377
323
687152222285
322
202
2049
54
52
937
622

ee3
1400
1401
1401
2185
DAR400
1495
950
1399
1399

ee4
181

z
W11454741

z1

z2
1932
2093
1815
1816
1822

z3
221
222
2071
2072
2073
2059
1817

z4
2121
1931
1945
1771
1770
1772

z5
2061
2058
2057

z6
1986
2060
2055

z7
1810
1824
1812
1825
1823
1826
1811

z8
1820
1814
1827
1828
1818

z9
2064

gg1
2056
2063
2062

gg2
2068

gg3

hh
1938
1929
1928
1943
1937
034264487949

hh1

hh2
7501206686997
937
1654

hh3
1921
1933
1934

ii1
2015
308
1846
2050
1967
1923
1911

nn
1216
1454

nn1

nn2
W11518678
798

nn3
28
1424
1306
1308
1307
1305

nn4
1805

nn5

ññ1
1583
1583
1583
7503026196458

ññ2

ññ3
7503026195734
2032
7503026414521
7503026195246

ññ4

ññ5
1720
1711

ññ6
2033

oo1
7503033971369
7503033971352

oo2
526
1671
1672

oo3
227
7503003799214
229

oo4
037103574886
1429
630

oo5
7503003799221
7503003799627
8033158076520

pp1
037103572264

pp2

pp3
6620132288042
2202

pp4
2240
1234

pp5

pp6
230

qq1
1965
1966
1999
`;

function normalizeSlotKey(raw) {
  const t = raw.trim();
  if (!t) return null;
  // ññ1 → ÑÑ1, ñ1 → Ñ1, aa4 → AA4
  return t
    .replace(/^ññ/i, 'ÑÑ')
    .replace(/^ñ/i, 'Ñ')
    .toLocaleUpperCase('es');
}

function isSlotHeader(line) {
  const t = line.trim();
  if (!t) return false;
  // Solo cabeceras cortas tipo a, a1, ññ3, zz, qq1 (no SKUs alfanuméricos largos).
  if (!/^[a-zñÑ]+[0-9]*$/i.test(t)) return false;
  const key = normalizeSlotKey(t);
  return key.length <= 4;
}

function parseLista(text) {
  /** @type {Record<string, string[]>} */
  const out = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isSlotHeader(trimmed)) {
      current = normalizeSlotKey(trimmed);
      if (!(current in out)) out[current] = [];
      continue;
    }
    if (!current) continue;
    // clean typos like 184/
    const code = trimmed.replace(/\/+$/, '');
    if (code) out[current].push(code);
  }
  return out;
}

function extractExistingSlot(src, slot) {
  const re = new RegExp(
    `${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(\\[[\\s\\S]*?\\])\\s*,`,
    'm'
  );
  const m = src.match(re);
  if (!m) return null;
  try {
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${m[1]});`)();
  } catch {
    return null;
  }
}

function fmtSlot(key, codes) {
  const uniq = codes; // preserve duplicates as in inventory lists
  if (uniq.length === 0) return `  ${key}: [],`;
  if (uniq.length <= 3) {
    return `  ${key}: [${uniq.map((c) => `'${String(c).replace(/'/g, "\\'")}'`).join(', ')}],`;
  }
  const body = uniq.map((c) => `    '${String(c).replace(/'/g, "\\'")}',`).join('\n');
  return `  ${key}: [\n${body}\n  ],`;
}

const lista = parseLista(RAW);
delete lista.J; // no slot J en el croquis (solo J1…)

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const products = catalog.products || [];
const suspensionSkus = products
  .filter((p) => {
    const n = (p.nombre || '').toLocaleLowerCase('es');
    return n.includes('suspension') || n.includes('suspensión') || n.includes('suspensiones');
  })
  .map((p) => String(p.sku).trim())
  .filter(Boolean);

lista.H = [...suspensionSkus];
lista.H1 = [...suspensionSkus];

let src = fs.readFileSync(PATH, 'utf8');
const nl = src.includes('\r\n') ? '\r\n' : '\n';
src = src.replace(/\r\n/g, '\n');

// Preserve slots not in the user list
const PRESERVE = ['BANDAS', 'Mostrador', 'Cajonera', 'Y1', 'FF1', 'GG', 'GG4', 'HH4', 'JJ', 'JJ1', 'JJ2', 'KK1', 'LL1', 'LL2', 'LL3', 'MM1', 'MM2', 'NN6', 'ÑÑ', 'OO', 'PP', 'G', 'G6', 'G7', 'G8', 'Z10', 'EE4'];
// EE4 IS in user list with 181 - don't preserve over lista
const preserveSkip = new Set(Object.keys(lista));

for (const slot of PRESERVE) {
  if (preserveSkip.has(slot)) continue;
  const existing = extractExistingSlot(src, slot);
  if (existing) lista[slot] = existing;
}

// Also preserve any other existing keys not overwritten
const existingKeys = [...src.matchAll(/^\s{2}([A-ZÑ][A-ZÑ0-9]*|Cajonera|BANDAS|Mostrador):\s*\[/gm)].map((m) => m[1]);
for (const slot of existingKeys) {
  if (slot in lista) continue;
  const existing = extractExistingSlot(src, slot);
  if (existing) lista[slot] = existing;
}

// SLOT_ORDER: keep current order, insert new slots (AA4, ZZ, QQ1 if missing)
const orderMatch = src.match(/const SLOT_ORDER = \[([\s\S]*?)\] as const;/);
if (!orderMatch) throw new Error('SLOT_ORDER not found');
/** @type {string[]} */
let order = [...orderMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

function ensureAfter(orderArr, slot, after) {
  if (orderArr.includes(slot)) return orderArr;
  const i = orderArr.indexOf(after);
  if (i >= 0) {
    orderArr.splice(i + 1, 0, slot);
  } else {
    orderArr.push(slot);
  }
  return orderArr;
}

order = ensureAfter(order, 'AA4', 'AA3');
order = ensureAfter(order, 'ZZ', 'W4');
order = ensureAfter(order, 'QQ1', 'PP6');
order = ensureAfter(order, 'EE4', 'EE3');

// Build object in SLOT_ORDER sequence, then any remaining keys
const orderedEntries = [];
const used = new Set();
for (const slot of order) {
  if (slot in lista) {
    orderedEntries.push([slot, lista[slot]]);
    used.add(slot);
  } else {
    orderedEntries.push([slot, []]);
    used.add(slot);
  }
}
for (const [slot, codes] of Object.entries(lista)) {
  if (used.has(slot)) continue;
  orderedEntries.push([slot, codes]);
  order.push(slot);
}

const objectBody = orderedEntries.map(([k, v]) => fmtSlot(k, v)).join('\n');
const newObject = `export const MUEBLE_POR_SLOT: Readonly<Record<string, readonly string[]>> = {\n${objectBody}\n};`;

const objRe =
  /export const MUEBLE_POR_SLOT: Readonly<Record<string, readonly string\[\]>> = \{[\s\S]*?\n\};/;
if (!objRe.test(src)) throw new Error('MUEBLE_POR_SLOT block not found');
src = src.replace(objRe, newObject);

const newOrder = `const SLOT_ORDER = [\n${order.map((s) => `  '${s}',`).join('\n')}\n] as const;`;
src = src.replace(/const SLOT_ORDER = \[[\s\S]*?\] as const;/, newOrder);

fs.writeFileSync(PATH, nl === '\r\n' ? src.replace(/\n/g, '\r\n') : src);

console.log('slots in lista:', Object.keys(lista).length);
console.log('H/H1 suspensions:', suspensionSkus.length);
console.log('AA4:', lista.AA4);
console.log('ZZ:', lista.ZZ);
console.log('QQ1:', lista.QQ1);
console.log('A sample:', lista.A?.slice(0, 5));
console.log('done');
