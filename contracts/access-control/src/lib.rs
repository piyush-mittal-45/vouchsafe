#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, Bytes, BytesN, Env, IntoVal,
    Symbol, Vec,
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

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct AccessRequest {
    pub id: u64,
    pub verifier: Address,
    pub subject: Address,
    pub credential_id: u64,
    pub requested_fields: Vec<Symbol>,
    pub status: Symbol, // "pending" | "granted" | "revoked" | "expired"
    pub expiry: u64,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct DisclosedField {
    pub name: Symbol,
    pub value: Bytes,
    pub salt: BytesN<32>,
    pub proof: Vec<BytesN<32>>,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    CredentialVault,
    Counter,
    AccessRequest(u64), // ID -> AccessRequest
}

#[allow(non_camel_case_types)]
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct disclosure {
    #[topic]
    pub request_id: u64,
    #[topic]
    pub verifier: Address,
    #[topic]
    pub field_name: Symbol,
}

#[contract]
pub struct AccessControl;

#[contractimpl]
impl AccessControl {
    pub fn initialize(env: Env, credential_vault: Address) {
        if env.storage().instance().has(&DataKey::CredentialVault) {
            panic!("already initialized");
        }
        env.storage()
            .instance()
            .set(&DataKey::CredentialVault, &credential_vault);
        env.storage().instance().set(&DataKey::Counter, &0u64);
    }

    pub fn get_credential_vault(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::CredentialVault)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    pub fn request_proof(
        env: Env,
        verifier: Address,
        subject: Address,
        credential_id: u64,
        requested_fields: Vec<Symbol>,
    ) -> u64 {
        verifier.require_auth();

        let mut counter: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        counter = counter.saturating_add(1);
        env.storage().instance().set(&DataKey::Counter, &counter);

        let request = AccessRequest {
            id: counter,
            verifier,
            subject,
            credential_id,
            requested_fields,
            status: Symbol::new(&env, "pending"),
            expiry: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::AccessRequest(counter), &request);
        counter
    }

    pub fn grant_access(env: Env, subject: Address, request_id: u64, expiry: u64) {
        subject.require_auth();

        let key = DataKey::AccessRequest(request_id);
        let mut request: AccessRequest = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("request not found"));

        if request.subject != subject {
            panic!("subject mismatch");
        }

        request.status = Symbol::new(&env, "granted");
        request.expiry = expiry;
        env.storage().persistent().set(&key, &request);
    }

    pub fn revoke_access(env: Env, subject: Address, request_id: u64) {
        subject.require_auth();

        let key = DataKey::AccessRequest(request_id);
        let mut request: AccessRequest = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("request not found"));

        if request.subject != subject {
            panic!("subject mismatch");
        }

        request.status = Symbol::new(&env, "revoked");
        env.storage().persistent().set(&key, &request);
    }

    pub fn verify_disclosure(env: Env, request_id: u64, disclosed: Vec<DisclosedField>) -> bool {
        let key = DataKey::AccessRequest(request_id);
        let mut request: AccessRequest = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("request not found"));

        if request.status != Symbol::new(&env, "granted") {
            return false;
        }

        if request.expiry > 0 && env.ledger().timestamp() > request.expiry {
            request.status = Symbol::new(&env, "expired");
            env.storage().persistent().set(&key, &request);
            return false;
        }

        let credential_vault = Self::get_credential_vault(env.clone());

        // Hop 1: Retrieve CredentialMeta from CredentialVault
        let credential_meta: CredentialMeta = env.invoke_contract(
            &credential_vault,
            &Symbol::new(&env, "get_credential_meta"),
            soroban_sdk::vec![&env, request.credential_id.into_val(&env)],
        );

        // Retrieve AttestationRegistry address from CredentialVault
        let attestation_registry: Address = env.invoke_contract(
            &credential_vault,
            &Symbol::new(&env, "get_attestation_registry"),
            soroban_sdk::vec![&env],
        );

        // Hop 2: Retrieve Attestation from AttestationRegistry
        let attestation: Attestation = env.invoke_contract(
            &attestation_registry,
            &Symbol::new(&env, "get_attestation"),
            soroban_sdk::vec![&env, credential_meta.attestation_id.into_val(&env)],
        );

        if attestation.revoked {
            return false;
        }

        for i in 0..disclosed.len() {
            let field = disclosed.get(i).unwrap();

            // 1. Verify field.name is in the credential's field_names
            let mut name_in_meta = false;
            for j in 0..credential_meta.field_names.len() {
                if credential_meta.field_names.get(j).unwrap() == field.name {
                    name_in_meta = true;
                    break;
                }
            }
            if !name_in_meta {
                return false;
            }

            // 2. Recompute leaf = sha256(name || value || salt)
            let mut leaf_bytes = Bytes::new(&env);
            use soroban_sdk::xdr::ToXdr;
            let name_xdr = field.name.clone().to_xdr(&env);
            leaf_bytes.append(&name_xdr);
            leaf_bytes.append(&field.value);
            let salt_bytes: Bytes = field.salt.into();
            leaf_bytes.append(&salt_bytes);
            let leaf: BytesN<32> = env.crypto().sha256(&leaf_bytes).into();

            // 3. Walk field.proof against merkle_root
            let mut current = leaf;
            for j in 0..field.proof.len() {
                let sibling = field.proof.get(j).unwrap();
                let mut concat = Bytes::new(&env);
                if current < sibling {
                    concat.append(&Bytes::from(current.clone()));
                    concat.append(&Bytes::from(sibling.clone()));
                } else {
                    concat.append(&Bytes::from(sibling.clone()));
                    concat.append(&Bytes::from(current.clone()));
                }
                current = env.crypto().sha256(&concat).into();
            }

            if current != attestation.merkle_root {
                return false;
            }

            // 4. Emit event: event_topic = "disclosure", fields = request_id, verifier, field name
            disclosure {
                request_id,
                verifier: request.verifier.clone(),
                field_name: field.name.clone(),
            }
            .publish(&env);
        }

        true
    }

    pub fn get_access_request(env: Env, id: u64) -> Option<AccessRequest> {
        env.storage().persistent().get(&DataKey::AccessRequest(id))
    }
}

mod test;
