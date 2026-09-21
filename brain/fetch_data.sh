#!/bin/sh
# Fetch the fly connectome data into brain/data/fly/ (gitignored, ~135 MB).
# Connectivity + completeness: Shiu et al., MIT code repo (FlyWire release 783).
# Annotations: flyconnectome/flywire_annotations supplemental file 1 (release 783).
# LICENCE OF THE DATA IS NOT VERIFIED - check FlyWire's terms before commercial use.
set -e
D="$(dirname "$0")/data/fly"; mkdir -p "$D"
M=https://github.com/philshiu/Drosophila_brain_model/raw/HEAD
A=https://github.com/flyconnectome/flywire_annotations/raw/HEAD/supplemental_files
curl -sL -o "$D/Completeness_783.csv"      $M/Completeness_783.csv
curl -sL -o "$D/Connectivity_783.parquet"  $M/Connectivity_783.parquet
curl -sL -o "$D/annotations.tsv"           $A/Supplemental_file1_neuron_annotations.tsv
ls -la "$D"
