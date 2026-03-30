# Progress Report Content - Team 238
# Interactive Intrusion Detection System
# CSE 6242 - Data and Visual Analytics
# Team Members: Jesus Barrera, Soma Parvathini, Belwin Julian, Jeremiah Zhao

---

## SECTION 1: Introduction [2%]

Cybersecurity analysts currently rely on static plots and binary ("attack vs. non-attack") classifications produced by opaque machine-learning systems. These "black box" approaches hide which network features contribute most to a detection decision, making it difficult for operators to understand, trust, or investigate flagged anomalies. Our project, the Interactive Intrusion Detection System, addresses this gap by combining Bayesian Online Changepoint Detection (BOCD) with interactive D3.js visualizations. Instead of a simple yes/no answer, our tool shows the probability that an attack is occurring and how confident the model is in its decision, all on user-adjustable timescales. The target users are security researchers and network operators who need to explore anomalies intuitively rather than accept black-box outputs.

---

## SECTION 2: Problem Definition [3%]

**Formal definition:** Given a multivariate time series of network flow features X = {x_1, x_2, ..., x_T} with corresponding ground-truth labels L = {l_1, l_2, ..., l_T} (where l_t is either "Benign" or an attack category), detect the set of changepoints C = {c_1, c_2, ..., c_k} where the statistical distribution of X shifts, and present these detections through interactive visualizations that allow a human analyst to:
1. Adjust the temporal granularity (bin size) of the analysis
2. Select which network features to analyze
3. Examine the full posterior probability distribution over run lengths (time since last changepoint)
4. Correlate detected changepoints with known attack labels

**Jargon-free version:** We want to build a tool that watches network traffic over time, automatically spots when something unusual starts happening, and lets a human analyst explore exactly when and why the system flagged something -- with sliders, charts, and heatmaps instead of just an alert.

---

## SECTION 3: Literature Survey [5%]

Our literature survey covers three areas: datasets, changepoint detection algorithms, and interactive visual analytics systems.

**Datasets:**
- Sharafaldin et al. (2018) [1] introduced the CIC-IDS2017 dataset with labeled traffic flows across 7 attack types. We use this as our primary dataset because it provides both raw features and ground-truth labels needed to evaluate our BOCD model.
- Moustafa & Slay (2015) [2] created UNSW-NB15, a complementary dataset with 9 attack families. While we considered this dataset, CIC-IDS2017 proved more suitable due to its temporal structure.
- CAIDA (2018) [3] provides unlabeled passive network traces from 2008-2019, useful for understanding raw packet data characteristics but lacking the attack labels we need for evaluation.

**Changepoint Detection:**
- Tartakovsky et al. (2006) [4] introduced CUSUM-based anomaly detection for network traffic, providing a computational speed baseline. Their approach uses automated statistical alerts without human interaction, which we improve upon.
- Adams & MacKay (2007) [5] developed the Bayesian Online Changepoint Detection algorithm that forms the mathematical core of our system. Their algorithm computes a posterior distribution over run lengths, enabling us to show both changepoint probabilities and uncertainty.
- Huang et al. (2020) [11] presented Laplacian Anomaly Detection for dynamic graphs, incorporating changepoint models. While the full implementation is out of scope, we studied their approach to dynamically updating node graphs.

**Visual Analytics:**
- Li et al. (2021) [6] created MTV, a visual analytics system for multivariate time-series anomaly detection. This provided the design framework for our D3.js interface, particularly the coordinated multiple-view approach.
- Ali et al. (2019) [7] developed TimeCluster for dimension reduction in temporal data, informing our approach to handling 77 network features through feature ranking and selection.
- Correa et al. (2009) [8] established a framework for uncertainty-aware visual analytics, guiding how we visualize the posterior probability distributions and confidence bands.
- Ali et al. (2019) [9] surveyed ML techniques for time-series visual analytics, providing proven integration concepts.
- Xu et al. (2020) [10] built CloudDet for temporal anomaly exploration in cloud systems, offering interface design patterns we adapted.
- McBride et al. (2023) [12] reviewed visualization methods for cyber-physical security, providing baseline styling and dashboard layout suggestions.

---

## SECTION 4: Proposed Method

### 4.1 Intuition -- Why Better Than State of the Art [10%]

Current intrusion detection systems suffer from two key limitations: (1) they produce binary classifications that hide the underlying reasoning, and (2) they use static visualizations that cannot be explored at different timescales. Our system improves on both fronts.

The Bayesian Online Changepoint Detection algorithm naturally produces a full posterior probability distribution over run lengths at each timestep, not just a point estimate. This means we can show an analyst not just "is there an attack?" but "how long has this regime been active?" and "how confident is the model?" -- information that is critical for understanding whether an anomaly is a brief spike or a sustained campaign.

By pairing BOCD with interactive D3.js visualizations, analysts can dynamically adjust the time granularity (from 100 to 5000 rows per bin), select different network features, and tune the model's sensitivity via the hazard rate parameter. This transforms intrusion detection from a passive alert system into an active exploration tool.

Our key innovations are:
1. **Interactive Bayesian posterior visualization** -- the PPD heatmap shows the full run-length posterior as a color-mapped canvas, allowing analysts to see regime durations and changepoint confidence simultaneously
2. **Linked multi-view coordination** -- brushing a time range on the time-series chart updates the heatmap, network topology, and attack summary in real time
3. **Feature-aware changepoint detection** -- users can switch between 77 network features to see which ones best reveal different attack types, guided by an automated feature ranking panel
4. **Adjustable sensitivity** -- hazard rate and threshold sliders let users trade off between false positives and false negatives interactively

### 4.2 Detailed Description of Approaches [35%]

**Architecture Overview:**
Our system uses a Flask (Python) backend serving REST API endpoints, with a D3.js v7 frontend for interactive visualization. The backend performs data loading, feature aggregation, and BOCD computation. The frontend renders three coordinated views: a time-series chart, a posterior probability heatmap, and a network topology graph.

**Dataset: CIC-IDS2017**
We use the CIC-IDS2017 dataset (Sharafaldin et al., 2018), obtained from Kaggle in Parquet format. The dataset contains 2,313,810 network flow records across 5 days (July 3-7, 2017) with 77 numeric features per flow and ground-truth attack labels. The days cover different attack scenarios:
- Monday: Benign only (458,831 flows)
- Tuesday: Brute Force -- FTP-Patator (5,931) and SSH-Patator (3,219) attacks among 380,564 benign flows
- Wednesday: DoS -- DoS Hulk (172,846), DoS GoldenEye (10,286), DoS slowloris (5,385), DoS Slowhttptest (5,228), and Heartbleed (11) among 391,235 benign flows
- Thursday: Web Attacks (morning) and Infiltration (afternoon)
- Friday: Botnet (morning), PortScan and DDoS (afternoon)

Since the Kaggle version strips timestamps and IP addresses, we generate synthetic timestamps spanning each day's working hours (9 AM - 5 PM) and construct a simplified network topology from attack-type labels.

**Data Preprocessing Pipeline:**
1. Load Parquet files with PyArrow
2. Add synthetic timestamps evenly spaced across the day's time range
3. Replace infinity values with NaN in numeric columns
4. Strip whitespace from label strings
5. Aggregate into time bins (configurable: 100, 500, 1000, 2000, or 5000 rows per bin)
6. For each bin, compute: feature mean, feature standard deviation, flow count, attack fraction, and dominant label

**BOCD Algorithm (Adams & MacKay, 2007):**
We implement the full Bayesian Online Changepoint Detection algorithm with a Normal-Gamma conjugate prior. The key components are:

*Hazard Function:* We use a constant hazard rate h (default 1/200), which gives a geometric prior on run lengths. This means the model expects a changepoint roughly every 200 timesteps. The hazard rate is exposed as an interactive slider.

*Observation Model:* We use a Gaussian likelihood with unknown mean and variance. The conjugate prior is Normal-Gamma with parameters (mu_0, kappa_0, alpha_0, beta_0). The predictive distribution under each run-length hypothesis is a Student-t distribution:
- Degrees of freedom: 2 * alpha
- Location: mu
- Scale: sqrt(beta * (kappa + 1) / (alpha * kappa))

*Update Equations:* At each new observation x_t, we:
1. Compute predictive probabilities P(x_t | r_t = r) for each current run length
2. Compute growth probabilities (no changepoint): P(r_t, x_1:t) = P(r_{t-1}, x_1:{t-1}) * P(x_t | r_t) * (1 - h)
3. Compute changepoint probability: P(r_t=0, x_1:t) = sum over all r of P(r_{t-1}) * P(x_t | r_{t-1}) * h
4. Normalize to get posterior P(r_t | x_1:t)
5. Update sufficient statistics for each run-length hypothesis

*Memory Optimization:* We truncate the run-length posterior at MAX_RUN_LENGTH = 500, accumulating tail probability mass into the last entry.

*Data Standardization:* Before running BOCD, we standardize the input data (subtract mean, divide by standard deviation) for numerical stability.

*Changepoint Scoring:* We combine two complementary signals: (a) the direct Bayesian probability P(r_t = 0) and (b) drops in the MAP (maximum a posteriori) run length. The combined score captures both gradual distributional shifts and abrupt regime changes.

*Posterior Matrix Downsampling:* The full T x 500 posterior matrix is downsampled to 200 x 200 using max-pooling for efficient transfer to the frontend.

**Flask API Design:**
We expose 7 REST endpoints:
1. GET /api/features -- lists 77 available numeric features with recommended defaults
2. GET /api/time-range -- returns dataset temporal boundaries per day
3. GET /api/timeseries -- returns aggregated time-series data for a selected feature and bin size
4. POST /api/bocd -- runs the BOCD algorithm and returns the downsampled posterior matrix, changepoint probabilities, and MAP run lengths
5. GET /api/network-flows -- returns node-link data for network topology visualization
6. GET /api/attack-summary -- returns attack label distribution with color coding
7. GET /api/feature-ranking -- ranks features by point-biserial correlation with the attack/benign label

Responses are JSON with computation time tracking. Data is cached globally to avoid reloading Parquet files on every request.

**D3.js Visualization Components:**

*1. Time-Series Chart (timeseries.js):*
- SVG-based line chart with d3.scaleTime() x-axis and d3.scaleLinear() y-axis
- Smooth monotone-X curve interpolation for the feature line
- Confidence band showing mean +/- 1 standard deviation using d3.area()
- Attack label overlays: colored semi-transparent rectangles per contiguous attack segment with text labels
- Changepoint markers: vertical dashed lines at timesteps where changepoint probability exceeds the user-set threshold
- Focus+context pattern: a small overview chart below with d3.brushX() for time range selection
- Hover tooltips showing timestamp, feature value, attack label, and attack percentage

*2. PPD Heatmap (heatmap.js):*
- Canvas-based pixel rendering for performance (920 x 280 pixels, 257,600 total)
- Per-column log normalization: for each timestep, maps log10(P / P_max) from [-4, 0] to [0, 1], colored via d3.interpolateInferno(). This reveals structure across 4 orders of magnitude that would be invisible under linear scaling.
- Dynamic y-axis cropping: automatically trims to the highest run-length with probability > 1e-6, eliminating wasted black space
- SVG overlay with: axes, MAP run-length trace (cyan step line), changepoint probability bar (red, above heatmap), and color legend
- Canvas rendering occurs in requestAnimationFrame() to prevent clearing by DOM mutations

*3. Network Topology (network.js):*
- D3 force-directed graph using d3.forceSimulation() with link, charge, center, and collision forces
- Nodes represent traffic categories (Benign, each attack type, Network hub)
- Node size proportional to flow count, colored blue (benign/internal) or pink (attack/external)
- Links show flow relationships with width proportional to count and color indicating attack fraction
- Directed edges with arrow markers
- Click interaction: selecting a node highlights its connections, dims unrelated links, and shows a detail panel with traffic type, flow count, share percentage, and an attack/benign indicator
- Drag interaction for repositioning nodes

*4. Controls Panel (controls.js):*
- Day selector: 8 buttons for each dataset day
- Feature dropdown: 77 numeric features
- Bin size selector: 100, 500, 1000, 2000, 5000 rows per bin
- Hazard rate slider: log-scaled from 1/500 to 1/10
- Changepoint threshold slider: 0.05 to 0.95
- Display toggles: attack labels, confidence bands, changepoints
- Feature ranking: bar chart of top 12 features by attack correlation, clickable to select

**Linked View Coordination:**
All views are coordinated through main.js. When the user changes any control (day, feature, bin size, BOCD parameters), the system fetches new data and updates all charts with animated transitions. Brushing a time range on the time-series chart triggers a BOCD recomputation for just that range, updating the heatmap and network graph. API calls are debounced by 300ms to prevent excessive requests during rapid interaction.

---

## SECTION 5: Evaluation

### 5.1 Testbed Description [5%]

**Dataset:** CIC-IDS2017, 2,313,810 records across 8 files (Parquet format), 77 numeric features, ground-truth attack labels covering 14 attack types plus benign traffic.

**Hardware:** Development and testing performed locally on personal machines.

**Software Stack:** Python 3.10 with Flask 3.1.2, NumPy 1.26.4, SciPy 1.13.1, Pandas 2.2.2, PyArrow 15.0.2. Frontend uses D3.js v7 loaded via CDN.

**Experiments we plan to answer:**
1. Does BOCD detect changepoints that align with known attack onset/offset times?
2. How does the hazard rate parameter affect precision vs. recall of changepoint detection?
3. Which network features are most effective at revealing different attack types?
4. Can users interactively identify attack patterns more effectively than with static plots?
5. What is the computational cost of BOCD at different bin sizes and data volumes?

### 5.2 Preliminary Experiments and Results [25%]

**Data Loading Verification (PASS):**
All 8 dataset days load correctly. Total: 2,313,810 rows. 77 features per day with no infinity values remaining after preprocessing. Attack distribution verified: Monday is benign-only, Wednesday has the most attacks (193,756), Thursday-Infil has the fewest (36).

**BOCD Algorithm Unit Tests (PASS):**
- Constant signal test: On 200 identical observations, the maximum changepoint probability equals the hazard rate (0.01) with no false detections. This confirms the model does not hallucinate changepoints in stable data.
- Mean shift test: On a signal that jumps from 0 to 10 at t=100, the changepoint probability at t=100 reaches 0.99. This confirms the model detects obvious distributional shifts.
- Posterior normalization test: The run-length posterior sums to exactly 1.0 at every timestep (deviation < 1e-6), confirming correct probability propagation.

**Changepoint vs. Attack Label Alignment (Wednesday -- DoS Day):**
Using Flow Duration as the analysis feature with bin size 1000 and hazard rate 0.005:
- Ground truth: 18 label transitions (Benign to/from various DoS types)
- Detected: 5 changepoints above threshold 0.3
- Hits (within +/- 5 bins tolerance): 3
- Precision: 0.60 (3 of 5 detections are true positives)
- Recall: 0.17 (3 of 18 true transitions detected)
- F1 Score: 0.26

This is expected behavior. BOCD detects distributional shifts, not every label change. Many label transitions (e.g., between similar DoS subtypes) don't change the statistical distribution enough to trigger detection. The interactive threshold slider and feature selection allow analysts to tune sensitivity for their specific investigation.

**API Performance:**
All 7 endpoints return valid JSON for all 8 days. BOCD computation time: 400-700ms for 585 data points (Wednesday). Timeseries endpoint: < 200ms. No errors across 56 endpoint-day combinations tested.

**Frontend Rendering Verification (PASS):**
- Time-series chart: SVG renders with line, 10 attack regions, 5 changepoint markers
- PPD heatmap: Canvas 920x280, 100% pixels filled (257,600/257,600), visible diagonal streaks showing run-length regimes with changepoint interruptions
- Network topology: 7 nodes rendered with correct attack/benign coloring
- Controls: 8 day buttons, 77 features, 12 ranking bars
- Day switching: All charts update correctly when changing between Wednesday and Tuesday

**Remaining Experiments (Planned):**
- Systematic hazard rate sweep (1/500 to 1/10) with precision-recall curves
- Per-attack-type detection analysis (DoS vs. Brute Force vs. DDoS)
- Multi-feature comparison (which of 77 features best detects each attack type)
- User study: compare investigation time using our tool vs. static matplotlib plots
- Computational scaling: benchmark BOCD at different bin sizes (100 to 5000)

---

## SECTION 6: Conclusions and Discussion [5%]

**Summary:** We have implemented a working prototype of the Interactive Intrusion Detection System that combines Bayesian Online Changepoint Detection with coordinated D3.js visualizations. The system loads the full CIC-IDS2017 dataset (2.3M+ records), runs BOCD in under 700ms, and renders three linked interactive views: a time-series chart with attack overlays, a posterior probability heatmap, and a network topology graph.

**Key Results:** The BOCD algorithm correctly identifies changepoints in synthetic test data and produces meaningful detections on real attack data (60% precision on Wednesday's DoS attacks). The posterior heatmap reveals interpretable structure -- diagonal streaks for stable regimes, abrupt drops at changepoints -- that is invisible in traditional binary classifiers.

**Limitations:**
- The dataset's Parquet format lacks timestamps and IP addresses, requiring synthetic generation. This limits the realism of the network topology view.
- BOCD with a single hazard rate may not suit all attack types equally; faster attacks (DDoS) may need higher hazard rates than slower infiltrations.
- Current recall (0.17) indicates the model misses subtle distributional transitions, particularly between similar attack subtypes.

**Future Extensions:**
- Implement multi-feature BOCD that combines evidence across multiple network features simultaneously
- Add CUSUM (Tartakovsky et al., 2006) as an alternative detection algorithm for comparison
- Explore adaptive hazard rates that auto-tune based on the data
- Conduct a formal user study with security professionals

**Team Effort Distribution:**
All team members have contributed a similar amount of effort. Work was distributed across data preprocessing (all members), BOCD algorithm implementation (Belwin, Soma), visualization development (Jesus, Jeremiah), and evaluation (Soma, Belwin).

---

## PLAN OF ACTIVITIES

### Original Plan (from Proposal):
| Activity | Team Member(s) | Start | End | Status |
|----------|----------------|-------|-----|--------|
| Data exploration and preprocessing | All Members | Feb 25 | Mar 06 | Done |
| Network background reading | All Members | Feb 25 | Mar 06 | Done |
| Statistics implementation studies | Belwin Julian | Mar 07 | Mar 18 | Done |
| Feature analysis / change point modeling | Soma Parvathini, Jeremiah Zhao | Mar 09 | Mar 20 | Done |
| Visualization mockups | Jesus Barrera, Belwin Julian | Mar 16 | Apr 02 | In Progress |
| D3 Visualization implementations - static | Jesus Barrera, Jeremiah Zhao | Mar 20 | Apr 08 | In Progress |
| D3 Visualization implementations - dynamic | Jesus Barrera, Jeremiah Zhao | Apr 04 | Apr 15 | Not Done |
| UI Testing | All Members | Apr 13 | Apr 18 | Not Done |
| Results Evaluation | Soma Parvathini, Belwin Julian | Apr 15 | Apr 21 | Not Done |
| Report | All Members | Apr 16 | Apr 24 | Not Done |
| Presentation | All Members | Apr 18 | Apr 24 | Not Done |
| Submission | Jesus Barrera | Apr 24 | Apr 24 | Not Done |
| Peer Review | All Members | Apr 28 | May 01 | Not Done |

### Revised Plan:
| Activity | Team Member(s) | Start | End | Status |
|----------|----------------|-------|-----|--------|
| Data exploration and preprocessing | All Members | Feb 25 | Mar 06 | Done |
| Network background reading | All Members | Feb 25 | Mar 06 | Done |
| Statistics implementation studies | Belwin Julian | Mar 07 | Mar 18 | Done |
| Feature analysis / change point modeling | Soma Parvathini, Jeremiah Zhao | Mar 09 | Mar 25 | Done |
| BOCD algorithm implementation | Belwin Julian, Soma Parvathini | Mar 18 | Mar 30 | Done |
| Flask API backend | All Members | Mar 25 | Apr 02 | Done |
| Visualization mockups | Jesus Barrera, Belwin Julian | Mar 16 | Mar 28 | Done |
| D3 Static visualizations (timeseries, heatmap) | Jesus Barrera, Jeremiah Zhao | Mar 28 | Apr 08 | In Progress |
| D3 Dynamic visualizations (brush, linked views) | Jesus Barrera, Jeremiah Zhao | Apr 04 | Apr 15 | Not Done |
| Hazard rate sensitivity experiments | Soma Parvathini, Belwin Julian | Apr 08 | Apr 15 | Not Done |
| Per-attack-type evaluation | All Members | Apr 13 | Apr 18 | Not Done |
| UI Testing and polish | All Members | Apr 15 | Apr 20 | Not Done |
| Final Report | All Members | Apr 16 | Apr 24 | Not Done |
| Presentation | All Members | Apr 18 | Apr 24 | Not Done |
| Submission | Jesus Barrera | Apr 24 | Apr 24 | Not Done |
| Peer Review | All Members | Apr 28 | May 01 | Not Done |

**Key changes from original plan:**
1. Added explicit BOCD implementation task (was implicit in "statistics implementation studies")
2. Added Flask API backend as a separate task
3. Extended feature analysis timeline by 5 days due to dataset format differences (Parquet vs expected CSV)
4. Split evaluation into hazard rate sensitivity and per-attack-type experiments
5. Added "UI Testing and polish" as a separate task from general UI Testing

---

## REFERENCES

1. Sharafaldin, I., Lashkari, A. H., & Ghorbani, A. A. (2018). Toward generating a new intrusion detection dataset and intrusion traffic characterization. Proceedings of the 4th International Conference on Information Systems Security and Privacy (ICISSP), 108-116.

2. Moustafa, N., & Slay, J. (2015). UNSW-NB15: A comprehensive data set for network intrusion detection systems. 2015 Military Communications and Information Systems Conference (MilCIS), 1-6.

3. Center for Applied Internet Data Analysis (CAIDA). (2018). The CAIDA Anonymized Internet Traces Dataset (April 2008 - January 2019).

4. Tartakovsky, A. G., Rozovskii, B. L., Blaise, R. B., & Brown, H. (2006). Efficient computer network anomaly detection by changepoint detection methods. IEEE Journal of Selected Topics in Signal Processing, 1(1), 4-11.

5. Adams, R. P., & MacKay, D. J. C. (2007). Bayesian online changepoint detection. arXiv preprint arXiv:0710.3742.

6. Li, J., Chen, Z., Wang, Z., Ding, Y., Sun, D., & Chen, Y. (2021). MTV: Visual analytics for detecting, investigating, and annotating anomalies in multivariate time series. arXiv preprint arXiv:2112.05734.

7. Ali, M., Jones, M. W., Xie, X., & Williams, M. (2019). TimeCluster: Dimension reduction applied to temporal data for visual analytics. The Visual Computer, 35(6), 1013-1026.

8. Correa, C. D., Chan, Y.-H., & Ma, K.-L. (2009). A framework for uncertainty-aware visual analytics. 2009 IEEE Symposium on Visual Analytics Science and Technology, 51-58.

9. Ali, M., Jones, M. W., Xie, X., & Williams, M. (2019). Clustering and classification for time series data in visual analytics: A survey. IEEE Access, 7, 181314-181338.

10. Xu, K., Wang, Y., Yang, L., Wang, Y., Qiao, B., Qin, S., Xu, Y., Zhang, H., & Qu, H. (2020). CloudDet: Interactive visual analysis of anomalous performances in cloud computing systems. IEEE Transactions on Visualization and Computer Graphics, 26(1), 1107-1117.

11. Huang, S., Hitti, Y., Rabusseau, G., Rabbany, R. (August 2020). Laplacian Change Point Detection for Dynamic Graphs. Association for Computing Machinery.

12. McBride, B., Vaagensmith, B.C., Cobilean, V., Kesler, E.J., Singh, V.K., Li, R., Rieger, C.G., Manic, M. (June 2023). A Review of Visualization Methods for Cyber-Physical Security: Smart Grid Case Study. Idaho National Laboratory.
