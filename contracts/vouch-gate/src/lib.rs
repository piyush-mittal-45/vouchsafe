#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, Bytes, BytesN, Env, IntoVal,
    Symbol, Vec,
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

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct VerificationRequest {
    pub request_id: u64,
    pub auditor: Address,
    pub owner: Address,
    pub vault_id: u64,
    pub required_attributes: Vec<Symbol>,
    pub request_state: Symbol, // "pending" | "approved" | "cancelled" | "timed_out"
    pub expiry_time: u64,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct RevealedAttribute {
    pub attribute_name: Symbol,
    pub raw_data: Bytes,
    pub hashing_salt: BytesN<32>,
    pub merkle_proof: Vec<BytesN<32>>,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    VaultContractAddress,
    GateCounter,
    ProofTicket(u64), // ID -> VerificationRequest
}

#[allow(non_camel_case_types)]
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct audit_trail {
    #[topic]
    pub audit_id: u64,
    #[topic]
    pub auditor: Address,
    #[topic]
    pub revealed_attribute: Symbol,
}

#[contract]
pub struct VouchGate;

#[contractimpl]
impl VouchGate {
    pub fn setup_gate(env: Env, credential_vault: Address) {
        if env.storage().instance().has(&DataKey::VaultContractAddress) {
            panic!("already initialized");
        }
        env.storage()
            .instance()
            .set(&DataKey::VaultContractAddress, &credential_vault);
        env.storage().instance().set(&DataKey::GateCounter, &0u64);
    }

    pub fn fetch_vault_address(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::VaultContractAddress)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    pub fn create_proof_request(
        env: Env,
        verifier: Address,
        subject: Address,
        credential_id: u64,
        requested_fields: Vec<Symbol>,
    ) -> u64 {
        verifier.require_auth();

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::GateCounter)
            .unwrap_or(0);
        counter = counter.saturating_add(1);
        env.storage()
            .instance()
            .set(&DataKey::GateCounter, &counter);

        let request = VerificationRequest {
            request_id: counter,
            auditor: verifier,
            owner: subject,
            vault_id: credential_id,
            required_attributes: requested_fields,
            request_state: Symbol::new(&env, "pending"),
            expiry_time: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::ProofTicket(counter), &request);
        counter
    }

    pub fn approve_disclosure(env: Env, subject: Address, request_id: u64, expiry: u64) {
        subject.require_auth();

        let key = DataKey::ProofTicket(request_id);
        let mut request: VerificationRequest = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("request not found"));

        if request.owner != subject {
            panic!("subject mismatch");
        }

        request.request_state = Symbol::new(&env, "approved");
        request.expiry_time = expiry;
        env.storage().persistent().set(&key, &request);
    }

    pub fn cancel_disclosure(env: Env, subject: Address, request_id: u64) {
        subject.require_auth();

        let key = DataKey::ProofTicket(request_id);
        let mut request: VerificationRequest = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("request not found"));

        if request.owner != subject {
            panic!("subject mismatch");
        }

        request.request_state = Symbol::new(&env, "cancelled");
        env.storage().persistent().set(&key, &request);
    }

    pub fn authenticate_proof(
        env: Env,
        request_id: u64,
        disclosed: Vec<RevealedAttribute>,
    ) -> bool {
        let key = DataKey::ProofTicket(request_id);
        let mut request: VerificationRequest = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("request not found"));

        if request.request_state != Symbol::new(&env, "approved") && request.request_state != Symbol::new(&env, "pending") {
            return false;
        }

        if request.expiry_time > 0 && env.ledger().timestamp() > request.expiry_time {
            request.request_state = Symbol::new(&env, "timed_out");
            env.storage().persistent().set(&key, &request);
            return false;
        }

        let credential_vault = Self::fetch_vault_address(env.clone());

        // Hop 1: Retrieve SecureCredential from VouchVault
        let credential_meta: SecureCredential = env.invoke_contract(
            &credential_vault,
            &Symbol::new(&env, "fetch_credential_details"),
            soroban_sdk::vec![&env, request.vault_id.into_val(&env)],
        );

        // Retrieve VouchRegistry address from VouchVault
        let attestation_registry: Address = env.invoke_contract(
            &credential_vault,
            &Symbol::new(&env, "fetch_registry_address"),
            soroban_sdk::vec![&env],
        );

        // Hop 2: Retrieve VouchRecord from VouchRegistry
        let attestation: VouchRecord = env.invoke_contract(
            &attestation_registry,
            &Symbol::new(&env, "fetch_vouch"),
            soroban_sdk::vec![&env, credential_meta.vouch_id.into_val(&env)],
        );

        if attestation.is_voided {
            return false;
        }

        for i in 0..disclosed.len() {
            let field = disclosed.get(i).unwrap();

            // 1. Verify field.attribute_name is in the credential's attributes
            let mut name_in_meta = false;
            for j in 0..credential_meta.attributes.len() {
                if credential_meta.attributes.get(j).unwrap() == field.attribute_name {
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
            let name_xdr = field.attribute_name.clone().to_xdr(&env);
            leaf_bytes.append(&name_xdr);
            leaf_bytes.append(&field.raw_data);
            let salt_bytes: Bytes = field.hashing_salt.into();
            leaf_bytes.append(&salt_bytes);
            let leaf: BytesN<32> = env.crypto().sha256(&leaf_bytes).into();

            // 3. Walk field.merkle_proof against proof_root
            let mut current = leaf;
            for j in 0..field.merkle_proof.len() {
                let sibling = field.merkle_proof.get(j).unwrap();
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

            if current != attestation.proof_root {
                return false;
            }

            // 4. Emit event: event_topic = "audit_trail", fields = request_id, verifier, field name
            audit_trail {
                audit_id: request_id,
                auditor: request.auditor.clone(),
                revealed_attribute: field.attribute_name.clone(),
            }
            .publish(&env);
        }

        true
    }

    pub fn fetch_request_ticket(env: Env, id: u64) -> Option<VerificationRequest> {
        env.storage().persistent().get(&DataKey::ProofTicket(id))
    }
}

mod test;
