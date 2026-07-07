#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Symbol};

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct VouchRecord {
    pub record_id: u64,
    pub authority: Address,
    pub holder: Address,
    pub vouch_type: Symbol,
    pub proof_root: BytesN<32>,
    pub format_hash: BytesN<32>,
    pub created_time: u64,
    pub expiration_time: u64,
    pub is_voided: bool,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    SuperOwner,
    Endorser(Address), // Endorser -> Name Symbol
    RecordCounter,
    RecordLookup(u64), // ID -> VouchRecord
}

#[contract]
pub struct VouchRegistry;

#[contractimpl]
impl VouchRegistry {
    pub fn setup_registry(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::SuperOwner) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::SuperOwner, &admin);
        env.storage().instance().set(&DataKey::RecordCounter, &0u64);
    }

    pub fn fetch_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::SuperOwner)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    pub fn authorize_endorser(env: Env, endorser: Address, name: Symbol) {
        let admin = Self::fetch_admin(env.clone());
        admin.require_auth();

        let key = DataKey::Endorser(endorser.clone());
        if env.storage().persistent().has(&key) {
            panic!("issuer already registered");
        }

        env.storage().persistent().set(&key, &name);
    }

    pub fn check_endorser_status(env: Env, endorser: Address) -> bool {
        env.storage().persistent().has(&DataKey::Endorser(endorser))
    }

    pub fn register_vouch(
        env: Env,
        issuer: Address,
        subject: Address,
        credential_type: Symbol,
        merkle_root: BytesN<32>,
        schema_hash: BytesN<32>,
        expires_at: u64,
    ) -> u64 {
        issuer.require_auth();

        if !Self::check_endorser_status(env.clone(), issuer.clone()) {
            panic!("issuer not authorized");
        }

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RecordCounter)
            .unwrap_or(0);
        counter = counter.saturating_add(1);
        env.storage()
            .instance()
            .set(&DataKey::RecordCounter, &counter);

        let issued_at = env.ledger().timestamp();

        let attestation = VouchRecord {
            record_id: counter,
            authority: issuer,
            holder: subject,
            vouch_type: credential_type,
            proof_root: merkle_root,
            format_hash: schema_hash,
            created_time: issued_at,
            expiration_time: expires_at,
            is_voided: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::RecordLookup(counter), &attestation);
        counter
    }

    pub fn void_vouch(env: Env, issuer: Address, attestation_id: u64) {
        issuer.require_auth();

        let key = DataKey::RecordLookup(attestation_id);
        let mut attestation: VouchRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("attestation not found"));

        if attestation.authority != issuer {
            panic!("only original issuer can revoke");
        }

        attestation.is_voided = true;
        env.storage().persistent().set(&key, &attestation);
    }

    pub fn fetch_vouch(env: Env, attestation_id: u64) -> VouchRecord {
        env.storage()
            .persistent()
            .get(&DataKey::RecordLookup(attestation_id))
            .unwrap_or_else(|| panic!("attestation not found"))
    }

    pub fn check_vouch_validity(env: Env, attestation_id: u64) -> bool {
        let key = DataKey::RecordLookup(attestation_id);
        let attestation_opt: Option<VouchRecord> = env.storage().persistent().get(&key);
        if let Some(attestation) = attestation_opt {
            if attestation.is_voided {
                return false;
            }
            if attestation.expiration_time > 0
                && env.ledger().timestamp() > attestation.expiration_time
            {
                return false;
            }
            true
        } else {
            false
        }
    }
}

mod test;
