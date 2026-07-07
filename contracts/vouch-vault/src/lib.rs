#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, IntoVal, Symbol, Vec,
};

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct SecureCredential {
    pub vault_id: u64,
    pub owner: Address,
    pub vouch_id: u64,
    pub storage_reference: Symbol,
    pub attributes: Vec<Symbol>,
    pub stored_timestamp: u64,
}

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
    RegistryContractAddress,
    VaultCounter,
    LockerItem(u64),                 // ID -> SecureCredential
    OwnerCredentialIndices(Address), // Owner -> Vec<u64>
}

#[contract]
pub struct VouchVault;

#[contractimpl]
impl VouchVault {
    pub fn setup_vault(env: Env, attestation_registry: Address) {
        if env
            .storage()
            .instance()
            .has(&DataKey::RegistryContractAddress)
        {
            panic!("already initialized");
        }
        env.storage()
            .instance()
            .set(&DataKey::RegistryContractAddress, &attestation_registry);
        env.storage().instance().set(&DataKey::VaultCounter, &0u64);
    }

    pub fn fetch_registry_address(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::RegistryContractAddress)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    pub fn lock_credential(
        env: Env,
        subject: Address,
        attestation_id: u64,
        pointer: Symbol,
        field_names: Vec<Symbol>,
    ) -> u64 {
        subject.require_auth();

        let attestation_registry = Self::fetch_registry_address(env.clone());

        // Cross-contract call 1: check_vouch_validity
        let is_valid: bool = env.invoke_contract(
            &attestation_registry,
            &Symbol::new(&env, "check_vouch_validity"),
            soroban_sdk::vec![&env, attestation_id.into_val(&env)],
        );
        if !is_valid {
            panic!("attestation is not valid");
        }

        // Cross-contract call 2: fetch_vouch to verify subject
        let attestation: VouchRecord = env.invoke_contract(
            &attestation_registry,
            &Symbol::new(&env, "fetch_vouch"),
            soroban_sdk::vec![&env, attestation_id.into_val(&env)],
        );
        if attestation.holder != subject {
            panic!("attestation subject mismatch");
        }

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::VaultCounter)
            .unwrap_or(0);
        counter = counter.saturating_add(1);
        env.storage()
            .instance()
            .set(&DataKey::VaultCounter, &counter);

        let meta = SecureCredential {
            vault_id: counter,
            owner: subject.clone(),
            vouch_id: attestation_id,
            storage_reference: pointer,
            attributes: field_names,
            stored_timestamp: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::LockerItem(counter), &meta);

        // Update list of credentials for subject
        let mut list = Self::query_owner_vault(env.clone(), subject.clone());
        list.push_back(counter);
        env.storage()
            .persistent()
            .set(&DataKey::OwnerCredentialIndices(subject), &list);

        counter
    }

    pub fn fetch_credential_details(env: Env, credential_id: u64) -> SecureCredential {
        env.storage()
            .persistent()
            .get(&DataKey::LockerItem(credential_id))
            .unwrap_or_else(|| panic!("credential metadata not found"))
    }

    pub fn query_owner_vault(env: Env, subject: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::OwnerCredentialIndices(subject))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn delete_credential(env: Env, subject: Address, credential_id: u64) {
        subject.require_auth();

        let meta = Self::fetch_credential_details(env.clone(), credential_id);
        if meta.owner != subject {
            panic!("subject mismatch");
        }

        env.storage()
            .persistent()
            .remove(&DataKey::LockerItem(credential_id));

        // Remove from list
        let list = Self::query_owner_vault(env.clone(), subject.clone());
        let mut new_list = Vec::new(&env);
        for i in 0..list.len() {
            let id = list.get(i).unwrap();
            if id != credential_id {
                new_list.push_back(id);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::OwnerCredentialIndices(subject), &new_list);
    }
}

mod test;
