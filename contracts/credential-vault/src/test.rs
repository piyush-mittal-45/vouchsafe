#![cfg(test)]

use super::*;
use attestation_registry::{AttestationRegistry, AttestationRegistryClient};
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, Ledger},
    Address, BytesN, Env, Symbol, Vec as SorobanVec,
};

fn setup_vault(
    env: &Env,
) -> (
    Address,
    Address,
    Address,
    AttestationRegistryClient<'_>,
    CredentialVaultClient<'_>,
) {
    env.mock_all_auths();
    env.ledger().set_timestamp(500);

    let admin = Address::generate(env);
    let issuer = Address::generate(env);
    let subject = Address::generate(env);

    // 1. Deploy Attestation Registry
    let att_reg_id = env.register(AttestationRegistry, ());
    let att_reg_client = AttestationRegistryClient::new(env, &att_reg_id);
    att_reg_client.initialize(&admin);
    let name = Symbol::new(env, "Gov");
    att_reg_client.register_issuer(&issuer, &name);

    // 2. Deploy Credential Vault
    let cred_vault_id = env.register(CredentialVault, ());
    let cred_vault_client = CredentialVaultClient::new(env, &cred_vault_id);
    cred_vault_client.initialize(&att_reg_id);

    (admin, issuer, subject, att_reg_client, cred_vault_client)
}

#[test]
fn test_store_credential_succeeds_if_valid() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault(&env);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(Symbol::new(&env, "name"));

    let id = cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);
    assert_eq!(id, 1);

    let meta = cred_vault_client.get_credential_meta(&id);
    assert_eq!(meta.id, 1);
    assert_eq!(meta.subject, subject);
    assert_eq!(meta.attestation_id, attestation_id);
    assert_eq!(meta.pointer, pointer);
    assert_eq!(meta.field_names, field_names);
}

#[test]
#[should_panic(expected = "attestation is not valid")]
fn test_store_credential_fails_if_invalid_or_nonexistent_id() {
    let env = Env::default();
    let (_, _, subject, _, cred_vault_client) = setup_vault(&env);

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let field_names = SorobanVec::new(&env);

    // Call store_credential with non-existent id 999
    cred_vault_client.store_credential(&subject, &999, &pointer, &field_names);
}

#[test]
#[should_panic(expected = "attestation is not valid")]
fn test_store_credential_fails_if_revoked() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault(&env);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );

    // Revoke
    att_reg_client.revoke_attestation(&issuer, &attestation_id);

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let field_names = SorobanVec::new(&env);

    cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);
}

#[test]
fn test_list_credentials_returns_correct_set() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault(&env);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let field_names = SorobanVec::new(&env);

    assert_eq!(cred_vault_client.list_credentials(&subject).len(), 0);

    let id = cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);
    let list = cred_vault_client.list_credentials(&subject);
    assert_eq!(list.len(), 1);
    assert_eq!(list.get(0).unwrap(), id);
}

#[test]
#[should_panic(expected = "subject mismatch")]
fn test_remove_credential_fails_for_non_owner() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault(&env);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let field_names = SorobanVec::new(&env);

    let id = cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);

    // Attacker tries to remove subject's credential
    let attacker = Address::generate(&env);
    cred_vault_client.remove_credential(&attacker, &id);
}

#[test]
#[should_panic(expected = "credential metadata not found")]
fn test_get_credential_meta_fails_for_nonexistent_id() {
    let env = Env::default();
    let (_, _, _, _, cred_vault_client) = setup_vault(&env);
    cred_vault_client.get_credential_meta(&999);
}

#[test]
#[should_panic(expected = "credential metadata not found")]
fn test_remove_credential_success() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault(&env);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let field_names = SorobanVec::new(&env);

    let id = cred_vault_client.store_credential(&subject, &attestation_id, &pointer, &field_names);

    // Remove the credential
    cred_vault_client.remove_credential(&subject, &id);

    // Check that it's no longer in list
    let list = cred_vault_client.list_credentials(&subject);
    assert_eq!(list.len(), 0);

    // This should panic with "credential metadata not found"
    cred_vault_client.get_credential_meta(&id);
}

#[test]
fn test_initialize_sets_registry_address() {
    let env = Env::default();
    let (_, _, _, att_reg_client, cred_vault_client) = setup_vault(&env);

    assert_eq!(
        cred_vault_client.get_attestation_registry(),
        att_reg_client.address
    );
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize_panics() {
    let env = Env::default();
    let (_, _, _, att_reg_client, cred_vault_client) = setup_vault(&env);

    cred_vault_client.initialize(&att_reg_client.address);
}

#[test]
fn test_credential_ids_increment_sequentially() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault(&env);

    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &BytesN::from_array(&env, &[1u8; 32]),
        &BytesN::from_array(&env, &[2u8; 32]),
        &0,
    );

    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(Symbol::new(&env, "name"));

    let first = cred_vault_client.store_credential(
        &subject,
        &attestation_id,
        &Symbol::new(&env, "ptr_one"),
        &field_names,
    );
    let second = cred_vault_client.store_credential(
        &subject,
        &attestation_id,
        &Symbol::new(&env, "ptr_two"),
        &field_names,
    );

    assert_eq!(first, 1);
    assert_eq!(second, 2);
}

#[test]
fn test_store_credential_requires_subject_auth() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault(&env);

    let attestation_id = att_reg_client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &BytesN::from_array(&env, &[1u8; 32]),
        &BytesN::from_array(&env, &[2u8; 32]),
        &0,
    );

    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(Symbol::new(&env, "name"));
    cred_vault_client.store_credential(
        &subject,
        &attestation_id,
        &Symbol::new(&env, "ptr"),
        &field_names,
    );

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    let (auth_address, invocation) = &auths[0];
    assert_eq!(auth_address, &subject);

    match &invocation.function {
        AuthorizedFunction::Contract((address, name, _args)) => {
            assert_eq!(address, &cred_vault_client.address);
            assert_eq!(name, &Symbol::new(&env, "store_credential"));
        }
        _ => panic!("unexpected auth function"),
    }
}
