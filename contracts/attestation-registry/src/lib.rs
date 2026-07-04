#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Symbol};

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Attestation {
    pub id: u64,
    pub issuer: Address,
    pub subject: Address,
    pub credential_type: Symbol,
    pub merkle_root: BytesN<32>,
    pub schema_hash: BytesN<32>,
    pub issued_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Issuer(Address), // Issuer -> Name Symbol
    Counter,
    Attestation(u64), // ID -> Attestation
}

#[contract]
pub struct AttestationRegistry;

#[contractimpl]
impl AttestationRegistry {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Counter, &0u64);
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    pub fn register_issuer(env: Env, issuer: Address, name: Symbol) {
        let admin = Self::get_admin(env.clone());
        admin.require_auth();

        let key = DataKey::Issuer(issuer.clone());
        if env.storage().persistent().has(&key) {
            panic!("issuer already registered");
        }

        env.storage().persistent().set(&key, &name);
    }

    pub fn is_issuer(env: Env, issuer: Address) -> bool {
        env.storage().persistent().has(&DataKey::Issuer(issuer))
    }

    pub fn issue_attestation(
        env: Env,
        issuer: Address,
        subject: Address,
        credential_type: Symbol,
        merkle_root: BytesN<32>,
        schema_hash: BytesN<32>,
        expires_at: u64,
    ) -> u64 {
        issuer.require_auth();

        if !Self::is_issuer(env.clone(), issuer.clone()) {
            panic!("issuer not authorized");
        }

        let mut counter: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        counter = counter.saturating_add(1);
        env.storage().instance().set(&DataKey::Counter, &counter);

        let issued_at = env.ledger().timestamp();

        let attestation = Attestation {
            id: counter,
            issuer,
            subject,
            credential_type,
            merkle_root,
            schema_hash,
            issued_at,
            expires_at,
            revoked: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Attestation(counter), &attestation);
        counter
    }

    pub fn revoke_attestation(env: Env, issuer: Address, attestation_id: u64) {
        issuer.require_auth();

        let key = DataKey::Attestation(attestation_id);
        let mut attestation: Attestation = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("attestation not found"));

        if attestation.issuer != issuer {
            panic!("only original issuer can revoke");
        }

        attestation.revoked = true;
        env.storage().persistent().set(&key, &attestation);
    }

    pub fn get_attestation(env: Env, attestation_id: u64) -> Attestation {
        env.storage()
            .persistent()
            .get(&DataKey::Attestation(attestation_id))
            .unwrap_or_else(|| panic!("attestation not found"))
    }

    pub fn is_valid(env: Env, attestation_id: u64) -> bool {
        let key = DataKey::Attestation(attestation_id);
        let attestation_opt: Option<Attestation> = env.storage().persistent().get(&key);
        if let Some(attestation) = attestation_opt {
            if attestation.revoked {
                return false;
            }
            if attestation.expires_at > 0 && env.ledger().timestamp() > attestation.expires_at {
                return false;
            }
            true
        } else {
            false
        }
    }
}

mod test;
