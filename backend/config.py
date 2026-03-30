import os

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
AGGREGATED_DIR = os.path.join(DATA_DIR, "aggregated")

# CIC-IDS2017 Parquet files (from Kaggle dhoogla/cicids2017)
# These files have no timestamp or IP columns (stripped as "no-metadata")
PARQUET_FILES = {
    "Monday": "Benign-Monday-no-metadata.parquet",
    "Tuesday": "Bruteforce-Tuesday-no-metadata.parquet",
    "Wednesday": "DoS-Wednesday-no-metadata.parquet",
    "Thursday-Web": "WebAttacks-Thursday-no-metadata.parquet",
    "Thursday-Infil": "Infiltration-Thursday-no-metadata.parquet",
    "Friday-Bot": "Botnet-Friday-no-metadata.parquet",
    "Friday-Port": "Portscan-Friday-no-metadata.parquet",
    "Friday-DDoS": "DDoS-Friday-no-metadata.parquet",
}

# Simulated time ranges per day (CIC-IDS2017 captured July 3-7, 2017, ~9am-5pm)
DAY_TIME_RANGES = {
    "Monday": ("2017-07-03 09:00:00", "2017-07-03 17:00:00"),
    "Tuesday": ("2017-07-04 09:00:00", "2017-07-04 17:00:00"),
    "Wednesday": ("2017-07-05 09:00:00", "2017-07-05 17:00:00"),
    "Thursday-Web": ("2017-07-06 09:00:00", "2017-07-06 12:00:00"),
    "Thursday-Infil": ("2017-07-06 13:00:00", "2017-07-06 17:00:00"),
    "Friday-Bot": ("2017-07-07 09:00:00", "2017-07-07 11:00:00"),
    "Friday-Port": ("2017-07-07 11:00:00", "2017-07-07 14:00:00"),
    "Friday-DDoS": ("2017-07-07 14:00:00", "2017-07-07 17:00:00"),
}

# Column names
LABEL_COL = "Label"

# Default features for initial analysis (confirmed from parquet schema)
DEFAULT_FEATURES = [
    "Flow Duration",
    "Total Fwd Packets",
    "Total Backward Packets",
    "Flow Bytes/s",
    "Flow Packets/s",
    "Fwd Packet Length Mean",
    "Bwd Packet Length Mean",
    "Flow IAT Mean",
    "Fwd IAT Mean",
    "Avg Packet Size",
    "Packet Length Variance",
    "Subflow Fwd Bytes",
]

# Attack type colors for consistent visualization
# Note: this dataset uses "Benign" not "BENIGN"
ATTACK_COLORS = {
    "Benign": "#4CAF50",
    "DoS Hulk": "#F44336",
    "DoS GoldenEye": "#E91E63",
    "DoS slowloris": "#FF5722",
    "DoS Slowhttptest": "#FF9800",
    "DDoS": "#9C27B0",
    "PortScan": "#2196F3",
    "FTP-Patator": "#00BCD4",
    "SSH-Patator": "#009688",
    "Bot": "#795548",
    "Web Attack - Brute Force": "#FFEB3B",
    "Web Attack - XSS": "#FFC107",
    "Web Attack - Sql Injection": "#FF9800",
    "Infiltration": "#607D8B",
    "Heartbleed": "#D50000",
}

# BOCD defaults
DEFAULT_HAZARD_RATE = 1 / 200
MAX_RUN_LENGTH = 500
HEATMAP_DOWNSAMPLE = 200

# Bin size options (number of rows to group per bin)
BIN_SIZES = {
    "100": 100,
    "500": 500,
    "1000": 1000,
    "2000": 2000,
    "5000": 5000,
}
DEFAULT_BIN_SIZE = "1000"
