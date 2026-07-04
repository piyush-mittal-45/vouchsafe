#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, IntoVal, Symbol, Vec,
};

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct CredentialMeta {
    pub id: u64,
    pub subject: Address,
    pub attestation_id: u64,
    pub pointer: Symbol,
    pub field_names: Vec<Symbol>,
    pub created_at: u64,
}

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
    AttestationRegistry,
    Counter,
    Credential(u64),             // ID -> CredentialMeta
    SubjectCredentials(Address), // Subject -> Vec<u64>
}

#[contract]
pub struct CredentialVault;

#[contractimpl]
impl CredentialVault {
    pub fn initialize(env: Env, attestation_registry: Address) {
        if env.storage().instance().has(&DataKey::AttestationRegistry) {
            panic!("already initialized");
        }
        env.storage()
            .instance()
            .set(&DataKey::AttestationRegistry, &attestation_registry);
        env.storage().instance().set(&DataKey::Counter, &0u64);
    }

    pub fn get_attestation_registry(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::AttestationRegistry)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    pub fn store_credential(
        env: Env,
        subject: Address,
        attestation_id: u64,
        pointer: Symbol,
        field_names: Vec<Symbol>,
    ) -> u64 {
        subject.require_auth();

        let attestation_registry = Self::get_attestation_registry(env.clone());

        // Cross-contract call 1: is_valid
        let is_valid: bool = env.invoke_contract(
            &attestation_registry,
            &Symbol::new(&env, "is_valid"),
            soroban_sdk::vec![&env, attestation_id.into_val(&env)],
        );
        if !is_valid {
            panic!("attestation is not valid");
        }

        // Cross-contract call 2: get_attestation to verify subject
        let attestation: Attestation = env.invoke_contract(
            &attestation_registry,
            &Symbol::new(&env, "get_attestation"),
            soroban_sdk::vec![&env, attestation_id.into_val(&env)],
        );
        if attestation.subject != subject {
            panic!("attestation subject mismatch");
        }

        let mut counter: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        counter = counter.saturating_add(1);
        env.storage().instance().set(&DataKey::Counter, &counter);

        let meta = CredentialMeta {
            id: counter,
            subject: subject.clone(),
            attestation_id,
            pointer,
            field_names,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Credential(counter), &meta);

        // Update list of credentials for subject
        let mut list = Self::list_credentials(env.clone(), subject.clone());
        list.push_back(counter);
        env.storage()
            .persistent()
            .set(&DataKey::SubjectCredentials(subject), &list);

        counter
    }

    pub fn get_credential_meta(env: Env, credential_id: u64) -> CredentialMeta {
        env.storage()
            .persistent()
            .get(&DataKey::Credential(credential_id))
            .unwrap_or_else(|| panic!("credential metadata not found"))
    }

    pub fn list_credentials(env: Env, subject: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::SubjectCredentials(subject))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn remove_credential(env: Env, subject: Address, credential_id: u64) {
        subject.require_auth();

        let meta = Self::get_credential_meta(env.clone(), credential_id);
        if meta.subject != subject {
            panic!("subject mismatch");
        }

        env.storage()
            .persistent()
            .remove(&DataKey::Credential(credential_id));

        // Remove from list
        let list = Self::list_credentials(env.clone(), subject.clone());
        let mut new_list = Vec::new(&env);
        for i in 0..list.len() {
            let id = list.get(i).unwrap();
            if id != credential_id {
                new_list.push_back(id);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::SubjectCredentials(subject), &new_list);
    }
}

mod test;
