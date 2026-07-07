#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, Ledger},
    Address, BytesN, Env, Symbol,
};

fn setup_registry_test(env: &Env) -> (Address, Address, Address, VouchRegistryClient<'_>) {
    env.mock_all_auths();
    env.ledger().set_timestamp(500);

    let admin = Address::generate(env);
    let issuer = Address::generate(env);
    let subject = Address::generate(env);

    let contract_id = env.register(VouchRegistry, ());
    let client = VouchRegistryClient::new(env, &contract_id);
    client.setup_registry(&admin);

    (admin, issuer, subject, client)
}

#[test]
fn test_issue_attestation_stores_correct_fields() {
    let env = Env::default();
    let (_, issuer, subject, client) = setup_registry_test(&env);

    let name = Symbol::new(&env, "Gov");
    client.authorize_endorser(&issuer, &name);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let expires_at = 1500;

    let id = client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &expires_at,
    );
    assert_eq!(id, 1);

    let att = client.fetch_vouch(&id);
    assert_eq!(att.record_id, 1);
    assert_eq!(att.authority, issuer);
    assert_eq!(att.holder, subject);
    assert_eq!(att.vouch_type, Symbol::new(&env, "passport"));
    assert_eq!(att.proof_root, merkle_root);
    assert_eq!(att.format_hash, schema_hash);
    assert_eq!(att.created_time, 500);
    assert_eq!(att.expiration_time, expires_at);
    assert!(!att.is_voided);
}

#[test]
fn test_revoke_attestation_flips_revoked_and_invalidates() {
    let env = Env::default();
    let (_, issuer, subject, client) = setup_registry_test(&env);

    let name = Symbol::new(&env, "Gov");
    client.authorize_endorser(&issuer, &name);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);

    let id = client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );
    assert!(client.check_vouch_validity(&id));

    client.void_vouch(&issuer, &id);
    let att = client.fetch_vouch(&id);
    assert!(att.is_voided);
    assert!(!client.check_vouch_validity(&id));
}

#[test]
fn test_is_valid_returns_false_past_expiry() {
    let env = Env::default();
    let (_, issuer, subject, client) = setup_registry_test(&env);

    let name = Symbol::new(&env, "Gov");
    client.authorize_endorser(&issuer, &name);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let expires_at = 1000;

    let id = client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &expires_at,
    );
    assert!(client.check_vouch_validity(&id));

    // Fast forward past expiry
    env.ledger().set_timestamp(1001);
    assert!(!client.check_vouch_validity(&id));
}

#[test]
#[should_panic(expected = "issuer not authorized")]
fn test_issue_attestation_fails_for_unregistered_issuer() {
    let env = Env::default();
    let (_, issuer, subject, client) = setup_registry_test(&env);

    // issuer is NOT registered
    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);

    client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );
}

#[test]
#[should_panic(expected = "attestation not found")]
fn test_get_attestation_fails_for_nonexistent_id() {
    let env = Env::default();
    let (_, _, _, client) = setup_registry_test(&env);
    client.fetch_vouch(&999);
}

#[test]
#[should_panic(expected = "issuer already registered")]
fn test_duplicate_issuer_registration_is_rejected() {
    let env = Env::default();
    let (_, issuer, _, client) = setup_registry_test(&env);

    let name = Symbol::new(&env, "Gov");
    client.authorize_endorser(&issuer, &name);
    // Duplicate call
    client.authorize_endorser(&issuer, &name);
}

#[test]
fn test_revoked_attestation_is_invalid() {
    let env = Env::default();
    let (_, issuer, subject, client) = setup_registry_test(&env);

    let name = Symbol::new(&env, "Gov");
    client.authorize_endorser(&issuer, &name);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);

    let id = client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );
    assert!(client.check_vouch_validity(&id));

    // Revoke it
    client.void_vouch(&issuer, &id);

    // It should now be invalid
    assert!(!client.check_vouch_validity(&id));
}

#[test]
fn test_initialize_sets_admin() {
    let env = Env::default();
    let (admin, _, _, client) = setup_registry_test(&env);

    assert_eq!(client.fetch_admin(), admin);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize_panics() {
    let env = Env::default();
    let (admin, _, _, client) = setup_registry_test(&env);

    client.setup_registry(&admin);
}

#[test]
fn test_attestation_ids_increment_sequentially() {
    let env = Env::default();
    let (_, issuer, subject, client) = setup_registry_test(&env);
    client.authorize_endorser(&issuer, &Symbol::new(&env, "Gov"));

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);

    let first = client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );
    let second = client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "license"),
        &merkle_root,
        &schema_hash,
        &0,
    );

    assert_eq!(first, 1);
    assert_eq!(second, 2);
}

#[test]
fn test_register_issuer_requires_admin_auth() {
    let env = Env::default();
    let (admin, issuer, _, client) = setup_registry_test(&env);

    client.authorize_endorser(&issuer, &Symbol::new(&env, "Gov"));

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    let (auth_address, invocation) = &auths[0];
    assert_eq!(auth_address, &admin);

    match &invocation.function {
        AuthorizedFunction::Contract((address, name, _args)) => {
            assert_eq!(address, &client.address);
            assert_eq!(name, &Symbol::new(&env, "authorize_endorser"));
        }
        _ => panic!("unexpected auth function"),
    }
}

#[test]
fn test_issue_attestation_requires_issuer_auth() {
    let env = Env::default();
    let (_, issuer, subject, client) = setup_registry_test(&env);
    client.authorize_endorser(&issuer, &Symbol::new(&env, "Gov"));

    client.register_vouch(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &BytesN::from_array(&env, &[1u8; 32]),
        &BytesN::from_array(&env, &[2u8; 32]),
        &0,
    );

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    let (auth_address, invocation) = &auths[0];
    assert_eq!(auth_address, &issuer);

    match &invocation.function {
        AuthorizedFunction::Contract((address, name, _args)) => {
            assert_eq!(address, &client.address);
            assert_eq!(name, &Symbol::new(&env, "register_vouch"));
        }
        _ => panic!("unexpected auth function"),
    }
}
