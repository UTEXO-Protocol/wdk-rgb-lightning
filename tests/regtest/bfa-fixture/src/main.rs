use rgb_lib::keys::{generate_keys, WitnessVersion};
use rgb_lib::wallet::{
    DatabaseType, OnlineOptions, Recipient, RgbWalletOpsOnline, SinglesigKeys, Wallet, WalletData,
};
use rgb_lib::{AssetSchema, BitcoinNetwork};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

// Test issuer only. Keys never leave this process; all funds are disposable regtest funds.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = std::env::args().nth(1).ok_or("wallet directory required")?;
    std::fs::create_dir_all(&data_dir)?;
    let keys = generate_keys(BitcoinNetwork::Regtest, WitnessVersion::Taproot);
    let mut wallet = Wallet::new(
        WalletData {
            data_dir,
            bitcoin_network: BitcoinNetwork::Regtest,
            database_type: DatabaseType::Sqlite,
            max_allocations_per_utxo: 5,
            supported_schemas: vec![AssetSchema::Bfa],
            reuse_addresses: false,
        },
        SinglesigKeys::from_keys(&keys, None),
    )?;
    let mut online = None;
    for line in io::stdin().lock().lines() {
        let request: Value = serde_json::from_str(&line?)?;
        let result = (|| -> Result<Value, Box<dyn std::error::Error>> {
            let text = |key: &str| -> Result<String, Box<dyn std::error::Error>> {
                Ok(request[key]
                    .as_str()
                    .ok_or("missing string parameter")?
                    .to_owned())
            };
            match request["method"].as_str().ok_or("method required")? {
                "address" => Ok(json!(wallet.get_address()?)),
                "online" => {
                    online = Some(wallet.go_online(OnlineOptions {
                        indexer_url: "tcp://127.0.0.1:29401".into(),
                        skip_consistency_check: false,
                        vanilla_sync_lookback: 20,
                        eth_rpc_url: Some("http://127.0.0.1:29545".into()),
                    })?);
                    Ok(json!(true))
                }
                "utxos" => Ok(json!(wallet.create_utxos(
                    online.ok_or("offline")?,
                    false,
                    Some(10),
                    Some(100_000),
                    2,
                    false
                )?)),
                "issue" => Ok(serde_json::to_value(wallet.issue_asset_bfa(
                    "TESTBFA".into(),
                    "Qualification BFA".into(),
                    6,
                    1,
                    text("contract")?,
                    None,
                )?)?),
                "begin" => {
                    let recipient: Recipient =
                        serde_json::from_value(request["recipient"].clone())?;
                    Ok(serde_json::to_value(wallet.bridge_begin(
                        online.ok_or("offline")?,
                        text("asset_id")?,
                        recipient,
                        2,
                        1,
                    )?)?)
                }
                "end" => {
                    let signed = wallet.sign_psbt(text("psbt")?, None)?;
                    Ok(serde_json::to_value(
                        wallet.bridge_end(online.ok_or("offline")?, signed)?,
                    )?)
                }
                "refresh" => Ok(serde_json::to_value(wallet.refresh(
                    online.ok_or("offline")?,
                    None,
                    vec![],
                    false,
                )?)?),
                _ => Err("unknown fixture method".into()),
            }
        })();
        let response = match result {
            Ok(value) => json!({"id": request["id"], "ok": true, "result": value}),
            Err(error) => json!({"id": request["id"], "ok": false, "error": error.to_string()}),
        };
        println!("fixture:{response}");
        io::stdout().flush()?;
    }
    Ok(())
}
