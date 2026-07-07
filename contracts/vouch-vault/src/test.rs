#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, Ledger},
    Address, BytesN, Env, Symbol, Vec as SorobanVec,
};
use vouch_registry::{VouchRegistry, VouchRegistryClient};

fn setup_vault_test(
    env: &Env,
) -> (
    Address,
    Address,
    Address,
    VouchRegistryClient<'_>,
    VouchVaultClient<'_>,
) {
    env.mock_all_auths();
    env.ledger().set_timestamp(500);

    let admin = Address::generate(env);
    let issuer = Address::generate(env);
    let subject = Address::generate(env);

    // 1. Deploy Vouch Registry
    let att_reg_id = env.register(VouchRegistry, ());
    let att_reg_client = VouchRegistryClient::new(env, &att_reg_id);
    att_reg_client.setup_registry(&admin);
    let name = Symbol::new(env, "Gov");
    att_reg_client.authorize_endorser(&issuer, &name);

    // 2. Deploy Vouch Vault
    let cred_vault_id = env.register(VouchVault, ());
    let cred_vault_client = VouchVaultClient::new(env, &cred_vault_id);
    cred_vault_client.setup_vault(&att_reg_id);

    (admin, issuer, subject, att_reg_client, cred_vault_client)
}

#[test]
fn test_store_credential_succeeds_if_valid() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault_test(&env);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let attestation_id = att_reg_client.register_vouch(
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

    let id = cred_vault_client.lock_credential(&subject, &attestation_id, &pointer, &field_names);
    assert_eq!(id, 1);

    let meta = cred_vault_client.fetch_credential_details(&id);
    assert_eq!(meta.vault_id, 1);
    assert_eq!(meta.owner, subject);
    assert_eq!(meta.vouch_id, attestation_id);
    assert_eq!(meta.storage_reference, pointer);
    assert_eq!(meta.attributes, field_names);
}

#[test]
#[should_panic(expected = "attestation is not valid")]
fn test_store_credential_fails_if_invalid_or_nonexistent_id() {
    let env = Env::default();
    let (_, _, subject, _, cred_vault_client) = setup_vault_test(&env);

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let field_names = SorobanVec::new(&env);

    // Call lock_credential with non-existent id 999
    cred_vault_client.lock_credential(&subject, &999, &pointer, &field_names);
}

#[test]
#[should_panic(expected = "attestation is not valid")]
fn test_store_credential_fails_if_revoked() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault_test(&env);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let attestation_id = att_reg_client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );

    // Revoke
    att_reg_client.void_vouch(&issuer, &attestation_id);

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let field_names = SorobanVec::new(&env);

    cred_vault_client.lock_credential(&subject, &attestation_id, &pointer, &field_names);
}

#[test]
fn test_list_credentials_returns_correct_set() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault_test(&env);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let attestation_id = att_reg_client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let field_names = SorobanVec::new(&env);

    assert_eq!(cred_vault_client.query_owner_vault(&subject).len(), 0);

    let id = cred_vault_client.lock_credential(&subject, &attestation_id, &pointer, &field_names);
    let list = cred_vault_client.query_owner_vault(&subject);
    assert_eq!(list.len(), 1);
    assert_eq!(list.get(0).unwrap(), id);
}

#[test]
#[should_panic(expected = "subject mismatch")]
fn test_remove_credential_fails_for_non_owner() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault_test(&env);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let attestation_id = att_reg_client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let field_names = SorobanVec::new(&env);

    let id = cred_vault_client.lock_credential(&subject, &attestation_id, &pointer, &field_names);

    // Attacker tries to remove subject's credential
    let attacker = Address::generate(&env);
    cred_vault_client.delete_credential(&attacker, &id);
}

#[test]
#[should_panic(expected = "credential metadata not found")]
fn test_get_credential_meta_fails_for_nonexistent_id() {
    let env = Env::default();
    let (_, _, _, _, cred_vault_client) = setup_vault_test(&env);
    cred_vault_client.fetch_credential_details(&999);
}

#[test]
#[should_panic(expected = "credential metadata not found")]
fn test_remove_credential_success() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault_test(&env);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let attestation_id = att_reg_client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );

    let pointer = Symbol::new(&env, "ipfs_somepointer");
    let field_names = SorobanVec::new(&env);

    let id = cred_vault_client.lock_credential(&subject, &attestation_id, &pointer, &field_names);

    // Remove the credential
    cred_vault_client.delete_credential(&subject, &id);

    // Check that it's no longer in list
    let list = cred_vault_client.query_owner_vault(&subject);
    assert_eq!(list.len(), 0);

    // This should panic with "credential metadata not found"
    cred_vault_client.fetch_credential_details(&id);
}

#[test]
fn test_initialize_sets_registry_address() {
    let env = Env::default();
    let (_, _, _, att_reg_client, cred_vault_client) = setup_vault_test(&env);

    assert_eq!(
        cred_vault_client.fetch_registry_address(),
        att_reg_client.address
    );
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize_panics() {
    let env = Env::default();
    let (_, _, _, att_reg_client, cred_vault_client) = setup_vault_test(&env);

    cred_vault_client.setup_vault(&att_reg_client.address);
}

#[test]
fn test_credential_ids_increment_sequentially() {
    let env = Env::default();
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault_test(&env);

    let attestation_id = att_reg_client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &BytesN::from_array(&env, &[1u8; 32]),
        &BytesN::from_array(&env, &[2u8; 32]),
        &0,
    );

    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(Symbol::new(&env, "name"));

    let first = cred_vault_client.lock_credential(
        &subject,
        &attestation_id,
        &Symbol::new(&env, "ptr_one"),
        &field_names,
    );
    let second = cred_vault_client.lock_credential(
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
    let (_, issuer, subject, att_reg_client, cred_vault_client) = setup_vault_test(&env);

    let attestation_id = att_reg_client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &BytesN::from_array(&env, &[1u8; 32]),
        &BytesN::from_array(&env, &[2u8; 32]),
        &0,
    );

    let mut field_names = SorobanVec::new(&env);
    field_names.push_back(Symbol::new(&env, "name"));
    cred_vault_client.lock_credential(
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
            assert_eq!(name, &Symbol::new(&env, "lock_credential"));
        }
        _ => panic!("unexpected auth function"),
    }
}
