                    Interactive Intrusion detection system user guide



1. Description 


This package is an Interactive Intrusion Detection System (IDS) that analyzes
network traffic from the CIC-IDS2017 dataset to detect and visualize cyber
attacks. The tool provides a browser-based dashboard where users can explore
eight full days of captured network flows (benign traffic, brute-force attacks,
DoS/DDoS attacks, web attacks, infiltration, botnet, and port-scanning) and
interactively investigate how attacks differ from normal behavior.

The backend is a Flask REST API (backend/app.py) that loads the CIC-IDS2017
parquet files, computes statistics, and serves them to the frontend. It runs
several analyses on demand, including Bayesian online change-point detection
on traffic time series, point-biserial and Student-t tests for feature
separability between benign and attack flows, down-sampled correlation
heatmaps, and distribution histograms across configurable bin sizes. A set of
twelve default network-flow features (flow duration, packet counts, byte and
packet rates, inter-arrival times, etc.) is used as the starting point for
analysis, and each attack class is assigned a consistent color for visual
identification.

The frontend is a single-page web application (frontend/index.html plus
frontend/css and frontend/js) that consumes the REST API and renders the
interactive visualizations in the browser. Together, the backend and frontend
let a user pick a day, pick features, and drill into the statistical
signatures of different intrusion types without writing any code.


2. Installation

Prerequisite: Python 3.9 or newer must be installed

Step 1 - Install the Python dependencies.

The project needs these packages downloaded (you can pip install these):

    flaskv3.1.2
    flask-cors 5.0.1
    numpy 1.26.4
    scipy 1.13.1
    pandas 2.2.2
    pyarrow 15.0.2

Or we added a requirements.txt file to make downlading all the packages a lot easier:
    pip install -r requirements.txt


Step 2 - Download CIC-IDS2017 dataset

There is a lot of files to download and they are quite lage.

Download the parquet files from Kaggle:

    https://www.kaggle.com/datasets/dhoogla/cicids2017

Have a data file and parquet files downloaded in them. There are a lot of files in the Kaggle but the ones below are the specifc ones we need. You need it in this :

The structure should look like this (parquet files stored in a folder named "data")

    data/
      Benign-Monday-no-metadata.parquet
      Bruteforce-Tuesday-no-metadata.parquet
      DoS-Wednesday-no-metadata.parquet
      WebAttacks-Thursday-no-metadata.parquet
      Infiltration-Thursday-no-metadata.parquet
      Botnet-Friday-no-metadata.parquet
      Portscan-Friday-no-metadata.parquet
      DDoS-Friday-no-metadata.parquet



3. Execution


Step 1 - Start the server by running this command:

    python backend/app.py

Step 2 - Open the dashboard.

Once the server is running, open a web browser and go to:

    http://localhost:5000

(Very unlikely, just know that the flask server might be running on a different port. However, the correct link (with the current port) shows up in the terminal so there shouldn't be any problem)

Step 3 - Use the demo version of our project since it should be working!
