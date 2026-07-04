#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, Symbol,
};

fn setup_registry(env: &Env) -> (Address, Address, Address, AttestationRegistryClient<'_>) {
    env.mock_all_auths();
    env.ledger().set_timestamp(500);

    let admin = Address::generate(env);
    let issuer = Address::generate(env);
    let subject = Address::generate(env);

    let contract_id = env.register(AttestationRegistry, ());
    let client = AttestationRegistryClient::new(env, &contract_id);
    client.initialize(&admin);

    (admin, issuer, subject, client)
}

#[test]
fn test_issue_attestation_stores_correct_fields() {
    let env = Env::default();
    let (_, issuer, subject, client) = setup_registry(&env);

    let name = Symbol::new(&env, "Gov");
    client.register_issuer(&issuer, &name);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let expires_at = 1500;

    let id = client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &expires_at,
    );
    assert_eq!(id, 1);

    let att = client.get_attestation(&id);
    assert_eq!(att.id, 1);
    assert_eq!(att.issuer, issuer);
    assert_eq!(att.subject, subject);
    assert_eq!(att.credential_type, Symbol::new(&env, "passport"));
    assert_eq!(att.merkle_root, merkle_root);
    assert_eq!(att.schema_hash, schema_hash);
    assert_eq!(att.issued_at, 500);
    assert_eq!(att.expires_at, expires_at);
    assert_eq!(att.revoked, false);
}

#[test]
fn test_revoke_attestation_flips_revoked_and_invalidates() {
    let env = Env::default();
    let (_, issuer, subject, client) = setup_registry(&env);

    let name = Symbol::new(&env, "Gov");
    client.register_issuer(&issuer, &name);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);

    let id = client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &0,
    );
    assert!(client.is_valid(&id));

    client.revoke_attestation(&issuer, &id);
    let att = client.get_attestation(&id);
    assert_eq!(att.revoked, true);
    assert!(!client.is_valid(&id));
}

#[test]
fn test_is_valid_returns_false_past_expiry() {
    let env = Env::default();
    let (_, issuer, subject, client) = setup_registry(&env);

    let name = Symbol::new(&env, "Gov");
    client.register_issuer(&issuer, &name);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);
    let expires_at = 1000;

    let id = client.issue_attestation(
        &issuer,
        &subject,
        &Symbol::new(&env, "passport"),
        &merkle_root,
        &schema_hash,
        &expires_at,
    );
    assert!(client.is_valid(&id));

    // Fast forward past expiry
    env.ledger().set_timestamp(1001);
    assert!(!client.is_valid(&id));
}

#[test]
#[should_panic(expected = "issuer not authorized")]
fn test_issue_attestation_fails_for_unregistered_issuer() {
    let env = Env::default();
    let (_, issuer, subject, client) = setup_registry(&env);

    // issuer is NOT registered
    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let schema_hash = BytesN::from_array(&env, &[2u8; 32]);

    client.issue_attestation(
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
    let (_, _, _, client) = setup_registry(&env);
    client.get_attestation(&999);
}

#[test]
#[should_panic(expected = "issuer already registered")]
fn test_duplicate_issuer_registration_is_rejected() {
    let env = Env::default();
    let (_, issuer, _, client) = setup_registry(&env);

    let name = Symbol::new(&env, "Gov");
    client.register_issuer(&issuer, &name);
    // Duplicate call
    client.register_issuer(&issuer, &name);
}
