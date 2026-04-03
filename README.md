1. Install Python dependencies. You need to pip install all of these:
flask==3.1.2
flask-cors==5.0.1
numpy==1.26.4
scipy==1.13.1
pandas==2.2.2
pyarrow==15.0.2


Or use this command with the requirements.txt: pip install -r requirements.txt

3. Download the CIC-IDS2017 parquet files from Kaggle: https://www.kaggle.com/datasets/dhoogla/cicids2017

Create a folder name data/ and put all the downloaded parquet files into there. It should look like this:

data/
  Benign-Monday-no-metadata.parquet
  Bruteforce-Tuesday-no-metadata.parquet
  DoS-Wednesday-no-metadata.parquet
  WebAttacks-Thursday-no-metadata.parquet
  Infiltration-Thursday-no-metadata.parquet
  Botnet-Friday-no-metadata.parquet
  Portscan-Friday-no-metadata.parquet
  DDoS-Friday-no-metadata.parquet

Check to make sure you have every single parquet file from above. The kaggle dataset has more than just those 8 parqet files but you only need those 8.
  
3. Start the server use this command:
python backend/app.py

4. Once you run the command above, go to http://localhost:5000 in your browser. It uses Flask so it most likely uses the 5000 port but it also shows in the terminal which port it uses.

Here is how the tool should look like after you get it running on your machine:
<img width="1900" height="782" alt="image" src="https://github.com/user-attachments/assets/65c9c7a8-7ef2-496f-b154-be288ac36b9b" />
