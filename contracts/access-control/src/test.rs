#![cfg(test)]

use super::*;
use attestation_registry::{AttestationRegistry, AttestationRegistryClient};
use credential_vault::{CredentialVault, CredentialVaultClient};
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, Ledger},
    Address, Bytes, BytesN, Env, Symbol, Vec as SorobanVec,
};

fn setup_all(
    env: &Env,
) -> (
    Address,
    Address,
    Address,
    Address,
    AttestationRegistryClient<'_>,
    CredentialVaultClient<'_>,
    AccessControlClient<'_>,
) {
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);

    let admin = Address::generate(env);
    let issuer = Address::generate(env);
    let subject = Address::generate(env);

    // 1. Deploy Attestation Registry
    let att_reg_id = env.register(AttestationRegistry, ());
    let att_reg_client = AttestationRegistryClient::new(env, &att_reg_id);
    att_reg_client.initialize(&admin);

    let name = Symbol::new(env, "Government");
    att_reg_client.register_issuer(&issuer, &name);

    // 2. Deploy Credential Vault
    let cred_vault_id = env.register(CredentialVault, ());
    let cred_vault_client = CredentialVaultClient::new(env, &cred_vault_id);
    cred_vault_client.initialize(&att_reg_id);

    // 3. Deploy Access Control
    let access_control_id = env.register(AccessControl, ());
    let access_control_client = AccessControlClient::new(env, &access_control_id);
    access_control_client.initialize(&cred_vault_id);

    (
        admin,
        issuer,
        subject,
        access_control_id,
        att_reg_client,
        cred_vault_client,
        access_control_client,
    )
}

fn compute_leaf(env: &Env, name: Symbol, value: &str, salt: &[u8; 32]) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    let mut bytes = Bytes::new(env);
    bytes.append(&name.to_xdr(env));
    bytes.append(&Bytes::from_slice(env, value.as_bytes()));
    bytes.append(&Bytes::from_slice(env, salt));
    env.crypto().sha256(&bytes).into()
}

fn compute_parent(env: &Env, a: BytesN<32>, b: BytesN<32>) -> BytesN<32> {
    let mut concat = Bytes::new(env);
    if a < b {
        concat.append(&Bytes::from(a));
        concat.append(&Bytes::from(b));
    } else {
        concat.append(&Bytes::from(b));
        concat.append(&Bytes::from(a));
    }
    env.crypto().sha256(&concat).into()
}

#[test]
fn test_verify_disclosure_success() {
    let env = Env::default();
    let (_, issuer, subject, _, att_reg_client, cred_vault_client, access_control_client) =
        setup_all(&env);

    let credential_type = Symbol::new(&env, "passport");
    let schema_hash = BytesN::from_array(&env, &[0u8; 32]);

    let name_sym = Symbol::new(&env, "name");
    let age_sym = Symbol::new(&env, "age");

    // Build Merkle Tree with 2 leaves
    let salt0 = [1u8; 32];
    let leaf0 = compute_leaf(&env, name_sym.clone(), "Alice", &salt0);

    let salt1 = [2u8; 32];
    let leaf1 = compute_leaf(&env, age_sym.clone(), "25", &salt1);

    let root = compute_parent(&env, leaf0.clone(), leaf1.clone());

    let expires_at = env.ledger().timestamp() + 3600;
    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &credential_type,
        &root,
        &schema_hash,
        &expires_at,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(name_sym.clone());
    field_names.push_back(age_sym.clone());

    let cred_id =
        cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);

    let verifier = Address::generate(&env);
    let mut requested_fields = SorobanVec::new(&env);
    requested_fields.push_back(name_sym.clone());

    let req_id =
        access_control_client.request_proof(&verifier, &subject, &cred_id, &requested_fields);

    let grant_expiry = env.ledger().timestamp() + 1800;
    access_control_client.grant_access(&subject, &req_id, &grant_expiry);

    let mut proof = SorobanVec::new(&env);
    proof.push_back(leaf1);

    let mut disclosed_fields = SorobanVec::new(&env);
    disclosed_fields.push_back(DisclosedField {
        name: name_sym,
        value: Bytes::from_slice(&env, "Alice".as_bytes()),
        salt: BytesN::from_array(&env, &salt0),
        proof,
    });

    let result = access_control_client.verify_disclosure(&req_id, &disclosed_fields);
    assert!(result);
}

#[test]
#[should_panic(expected = "subject mismatch")]
fn test_grant_access_unauthorized() {
    let env = Env::default();
    let (_, issuer, subject, _, att_reg_client, cred_vault_client, access_control_client) =
        setup_all(&env);

    let name_sym = Symbol::new(&env, "name");
    let salt0 = [1u8; 32];
    let leaf0 = compute_leaf(&env, name_sym.clone(), "Alice", &salt0);
    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &leaf0,
        &BytesN::from_array(&env, &[0u8; 32]),
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(name_sym.clone());
    let cred_id =
        cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);

    let verifier = Address::generate(&env);
    let mut requested_fields = SorobanVec::new(&env);
    requested_fields.push_back(name_sym.clone());

    let req_id =
        access_control_client.request_proof(&verifier, &subject, &cred_id, &requested_fields);

    let attacker = Address::generate(&env);
    // Attacker tries to grant access instead of subject
    access_control_client.grant_access(&attacker, &req_id, &2000);
}

#[test]
fn test_verify_disclosure_failure_tampered_value() {
    let env = Env::default();
    let (_, issuer, subject, _, att_reg_client, cred_vault_client, access_control_client) =
        setup_all(&env);

    let name_sym = Symbol::new(&env, "name");
    let age_sym = Symbol::new(&env, "age");
    let salt0 = [1u8; 32];
    let leaf0 = compute_leaf(&env, name_sym.clone(), "Alice", &salt0);
    let salt1 = [2u8; 32];
    let leaf1 = compute_leaf(&env, age_sym.clone(), "25", &salt1);
    let root = compute_parent(&env, leaf0.clone(), leaf1.clone());

    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &root,
        &BytesN::from_array(&env, &[0u8; 32]),
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(name_sym.clone());
    field_names.push_back(age_sym.clone());
    let cred_id =
        cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);

    let verifier = Address::generate(&env);
    let mut requested_fields = SorobanVec::new(&env);
    requested_fields.push_back(name_sym.clone());
    let req_id =
        access_control_client.request_proof(&verifier, &subject, &cred_id, &requested_fields);
    access_control_client.grant_access(&subject, &req_id, &2000);

    let mut proof = SorobanVec::new(&env);
    proof.push_back(leaf1);
    let mut disclosed_fields = SorobanVec::new(&env);
    disclosed_fields.push_back(DisclosedField {
        name: name_sym,
        value: Bytes::from_slice(&env, "Bob".as_bytes()), // Tampered value
        salt: BytesN::from_array(&env, &salt0),
        proof,
    });

    let result = access_control_client.verify_disclosure(&req_id, &disclosed_fields);
    assert!(!result);
}

#[test]
fn test_verify_disclosure_failure_wrong_salt() {
    let env = Env::default();
    let (_, issuer, subject, _, att_reg_client, cred_vault_client, access_control_client) =
        setup_all(&env);

    let name_sym = Symbol::new(&env, "name");
    let age_sym = Symbol::new(&env, "age");
    let salt0 = [1u8; 32];
    let leaf0 = compute_leaf(&env, name_sym.clone(), "Alice", &salt0);
    let salt1 = [2u8; 32];
    let leaf1 = compute_leaf(&env, age_sym.clone(), "25", &salt1);
    let root = compute_parent(&env, leaf0.clone(), leaf1.clone());

    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &root,
        &BytesN::from_array(&env, &[0u8; 32]),
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(name_sym.clone());
    field_names.push_back(age_sym.clone());
    let cred_id =
        cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);

    let verifier = Address::generate(&env);
    let mut requested_fields = SorobanVec::new(&env);
    requested_fields.push_back(name_sym.clone());
    let req_id =
        access_control_client.request_proof(&verifier, &subject, &cred_id, &requested_fields);
    access_control_client.grant_access(&subject, &req_id, &2000);

    let wrong_salt = [9u8; 32];
    let mut proof = SorobanVec::new(&env);
    proof.push_back(leaf1);
    let mut disclosed_fields = SorobanVec::new(&env);
    disclosed_fields.push_back(DisclosedField {
        name: name_sym,
        value: Bytes::from_slice(&env, "Alice".as_bytes()),
        salt: BytesN::from_array(&env, &wrong_salt), // Wrong salt
        proof,
    });

    let result = access_control_client.verify_disclosure(&req_id, &disclosed_fields);
    assert!(!result);
}

#[test]
fn test_verify_disclosure_failure_expired_grant() {
    let env = Env::default();
    let (_, issuer, subject, _, att_reg_client, cred_vault_client, access_control_client) =
        setup_all(&env);

    let name_sym = Symbol::new(&env, "name");
    let salt0 = [1u8; 32];
    let leaf0 = compute_leaf(&env, name_sym.clone(), "Alice", &salt0);
    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &leaf0,
        &BytesN::from_array(&env, &[0u8; 32]),
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(name_sym.clone());
    let cred_id =
        cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);

    let verifier = Address::generate(&env);
    let mut requested_fields = SorobanVec::new(&env);
    requested_fields.push_back(name_sym.clone());
    let req_id =
        access_control_client.request_proof(&verifier, &subject, &cred_id, &requested_fields);
    access_control_client.grant_access(&subject, &req_id, &1500);

    // Fast-forward past expiry
    env.ledger().set_timestamp(1501);

    let proof = SorobanVec::new(&env);
    let mut disclosed_fields = SorobanVec::new(&env);
    disclosed_fields.push_back(DisclosedField {
        name: name_sym,
        value: Bytes::from_slice(&env, "Alice".as_bytes()),
        salt: BytesN::from_array(&env, &salt0),
        proof,
    });

    let result = access_control_client.verify_disclosure(&req_id, &disclosed_fields);
    assert!(!result);
}

#[test]
fn test_verify_disclosure_failure_revoked_grant() {
    let env = Env::default();
    let (_, issuer, subject, _, att_reg_client, cred_vault_client, access_control_client) =
        setup_all(&env);

    let name_sym = Symbol::new(&env, "name");
    let salt0 = [1u8; 32];
    let leaf0 = compute_leaf(&env, name_sym.clone(), "Alice", &salt0);
    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &leaf0,
        &BytesN::from_array(&env, &[0u8; 32]),
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(name_sym.clone());
    let cred_id =
        cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);

    let verifier = Address::generate(&env);
    let mut requested_fields = SorobanVec::new(&env);
    requested_fields.push_back(name_sym.clone());
    let req_id =
        access_control_client.request_proof(&verifier, &subject, &cred_id, &requested_fields);
    access_control_client.grant_access(&subject, &req_id, &2000);

    // Revoke
    access_control_client.revoke_access(&subject, &req_id);

    let proof = SorobanVec::new(&env);
    let mut disclosed_fields = SorobanVec::new(&env);
    disclosed_fields.push_back(DisclosedField {
        name: name_sym,
        value: Bytes::from_slice(&env, "Alice".as_bytes()),
        salt: BytesN::from_array(&env, &salt0),
        proof,
    });

    let result = access_control_client.verify_disclosure(&req_id, &disclosed_fields);
    assert!(!result);
}

#[test]
fn test_verify_disclosure_failure_field_not_in_schema() {
    let env = Env::default();
    let (_, issuer, subject, _, att_reg_client, cred_vault_client, access_control_client) =
        setup_all(&env);

    let name_sym = Symbol::new(&env, "name");
    let salt0 = [1u8; 32];
    let leaf0 = compute_leaf(&env, name_sym.clone(), "Alice", &salt0);
    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &leaf0,
        &BytesN::from_array(&env, &[0u8; 32]),
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(name_sym.clone()); // Only name is in schema
    let cred_id =
        cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);

    let verifier = Address::generate(&env);
    let age_sym = Symbol::new(&env, "age");
    let mut requested_fields = SorobanVec::new(&env);
    requested_fields.push_back(age_sym.clone());
    let req_id =
        access_control_client.request_proof(&verifier, &subject, &cred_id, &requested_fields);
    access_control_client.grant_access(&subject, &req_id, &2000);

    let proof = SorobanVec::new(&env);
    let mut disclosed_fields = SorobanVec::new(&env);
    disclosed_fields.push_back(DisclosedField {
        name: age_sym, // Not in schema!
        value: Bytes::from_slice(&env, "25".as_bytes()),
        salt: BytesN::from_array(&env, &salt0),
        proof,
    });

    let result = access_control_client.verify_disclosure(&req_id, &disclosed_fields);
    assert!(!result);
}

#[test]
fn test_initialize_sets_credential_vault() {
    let env = Env::default();
    let (_, _, _, _, _, cred_vault_client, access_control_client) = setup_all(&env);

    assert_eq!(
        access_control_client.get_credential_vault(),
        cred_vault_client.address
    );
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize_panics() {
    let env = Env::default();
    let (_, _, _, _, _, cred_vault_client, access_control_client) = setup_all(&env);

    access_control_client.initialize(&cred_vault_client.address);
}

#[test]
fn test_request_ids_increment_sequentially() {
    let env = Env::default();
    let (_, _, subject, _, _, _, access_control_client) = setup_all(&env);
    let verifier = Address::generate(&env);

    let mut requested = SorobanVec::new(&env);
    requested.push_back(Symbol::new(&env, "name"));

    let first = access_control_client.request_proof(&verifier, &subject, &1, &requested);
    let second = access_control_client.request_proof(&verifier, &subject, &1, &requested);

    assert_eq!(first, 1);
    assert_eq!(second, 2);
}

#[test]
fn test_get_access_request_returns_none_for_unknown_id() {
    let env = Env::default();
    let (_, _, _, _, _, _, access_control_client) = setup_all(&env);

    assert!(access_control_client.get_access_request(&999).is_none());
}

#[test]
fn test_request_proof_requires_verifier_auth() {
    let env = Env::default();
    let (_, _, subject, _, _, _, access_control_client) = setup_all(&env);
    let verifier = Address::generate(&env);

    let mut requested = SorobanVec::new(&env);
    requested.push_back(Symbol::new(&env, "name"));
    access_control_client.request_proof(&verifier, &subject, &1, &requested);

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    let (auth_address, invocation) = &auths[0];
    assert_eq!(auth_address, &verifier);

    match &invocation.function {
        AuthorizedFunction::Contract((address, name, _args)) => {
            assert_eq!(address, &access_control_client.address);
            assert_eq!(name, &Symbol::new(&env, "request_proof"));
        }
        _ => panic!("unexpected auth function"),
    }
}

#[test]
fn test_grant_access_requires_subject_auth() {
    let env = Env::default();
    let (_, _, subject, _, _, _, access_control_client) = setup_all(&env);
    let verifier = Address::generate(&env);

    let mut requested = SorobanVec::new(&env);
    requested.push_back(Symbol::new(&env, "name"));
    let request_id = access_control_client.request_proof(&verifier, &subject, &1, &requested);

    access_control_client.grant_access(&subject, &request_id, &2000);

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    let (auth_address, invocation) = &auths[0];
    assert_eq!(auth_address, &subject);

    match &invocation.function {
        AuthorizedFunction::Contract((address, name, _args)) => {
            assert_eq!(address, &access_control_client.address);
            assert_eq!(name, &Symbol::new(&env, "grant_access"));
        }
        _ => panic!("unexpected auth function"),
    }
}
