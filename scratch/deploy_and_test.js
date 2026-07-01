const { xdr, crypto } = require('@stellar/stellar-sdk');
const { execSync } = require('child_process');
const nodeCrypto = require('crypto');

const REGISTRY_ID = "CDPHPDGZTO35WUEZSY6MO6EYNE4J323NANZRAIZIFGKEDGEIR6BAQEG3";
const VAULT_ID = "CB7LCLRBAVDKEUU727CFYXO7WQNHHHGRW4UXXFFYZXPYUVK3VXXDBZY3";
const ACCESS_ID = "CDY2F43CTJZ5T74CXZHRNTDZZWI62GK5BWV3VMV2ADHLR74SQ73RX3XT";

// Derive/Generate keypairs for issuer, subject, and verifier
function runCmd(cmd) {
    console.log(`> ${cmd}`);
    try {
        return execSync(cmd, { encoding: 'utf8' }).trim();
    } catch (err) {
        console.error(err.stdout || err.stderr || err.message);
        throw err;
    }
}

function fundAddress(addr) {
    console.log(`Funding ${addr} via Friendbot...`);
    runCmd(`curl -s "https://friendbot.stellar.org/?addr=${addr}"`);
}

function generateIdentity(name) {
    try {
        runCmd(`stellar keys generate ${name} --network testnet`);
    } catch (err) {
        console.log(`Identity ${name} already exists or failed to generate.`);
    }
    const addr = runCmd(`stellar keys address ${name}`);
    return addr;
}

function sha256(buffer) {
    return nodeCrypto.createHash('sha256').update(buffer).digest();
}

function computeLeaf(name, valueStr, saltBuffer) {
    const nameXdr = xdr.ScVal.scvSymbol(name).toXDR();
    const valueBuffer = Buffer.from(valueStr, 'utf8');
    const concat = Buffer.concat([nameXdr, valueBuffer, saltBuffer]);
    return sha256(concat);
}

function computeParent(a, b) {
    const concat = Buffer.compare(a, b) < 0 ? Buffer.concat([a, b]) : Buffer.concat([b, a]);
    return sha256(concat);
}

async function main() {
    console.log("Setting up identities...");
    const issuerAddr = generateIdentity("vouchsafe_issuer");
    const subjectAddr = generateIdentity("vouchsafe_subject");
    const verifierAddr = generateIdentity("vouchsafe_verifier");

    console.log(`Issuer: ${issuerAddr}`);
    console.log(`Subject: ${subjectAddr}`);
    console.log(`Verifier: ${verifierAddr}`);

    // Fund the new identities
    fundAddress(issuerAddr);
    fundAddress(subjectAddr);
    fundAddress(verifierAddr);

    // 1. Register Issuer
    console.log("\n--- Registering Issuer ---");
    const regIssuerCmd = `stellar contract invoke --id ${REGISTRY_ID} --source vouchsafe_deployer --network testnet -- register_issuer --issuer ${issuerAddr} --name Government`;
    try {
        const regIssuerOut = runCmd(regIssuerCmd);
        console.log(regIssuerOut);
    } catch (err) {
        console.log("Issuer registration failed or already registered, continuing...");
    }

    // Compute Merkle Tree
    console.log("\n--- Computing Merkle Root & Proofs ---");
    const salt0 = nodeCrypto.randomBytes(32);
    const salt1 = nodeCrypto.randomBytes(32);
    const salt2 = nodeCrypto.randomBytes(32);

    const leaf0 = computeLeaf("full_name", "Alice Smith", salt0);
    const leaf1 = computeLeaf("date_of_birth", "1990-01-01", salt1);
    const leaf2 = computeLeaf("license_class", "Class A", salt2);

    const parent0 = computeParent(leaf0, leaf1);
    const parent1 = computeParent(leaf2, leaf2); // duplicate leaf2
    const root = computeParent(parent0, parent1);

    console.log(`Root hash (hex): ${root.toString('hex')}`);

    // 2. Issue Attestation
    console.log("\n--- Issuing Attestation ---");
    const issueCmd = `stellar contract invoke --id ${REGISTRY_ID} --source vouchsafe_issuer --network testnet -- issue_attestation --issuer ${issuerAddr} --subject ${subjectAddr} --credential_type passport --merkle_root ${root.toString('hex')} --schema_hash 0000000000000000000000000000000000000000000000000000000000000000 --expires_at 0`;
    const issueOut = runCmd(issueCmd);
    console.log(issueOut);
    
    // Attestation ID is 1 (first attestation)
    const attestationId = 1;

    // 3. Store Credential in Vault
    console.log("\n--- Storing Credential in Vault ---");
    const storeCmd = `stellar contract invoke --id ${VAULT_ID} --source vouchsafe_subject --network testnet -- store_credential --subject ${subjectAddr} --attestation_id ${attestationId} --pointer ipfs_hash_example --field_names '["full_name", "date_of_birth", "license_class"]'`;
    const storeOut = runCmd(storeCmd);
    console.log(storeOut);

    // Credential ID is 1
    const credentialId = 1;

    // 4. Request Proof (Verifier)
    console.log("\n--- Requesting Proof ---");
    const requestCmd = `stellar contract invoke --id ${ACCESS_ID} --source vouchsafe_verifier --network testnet -- request_proof --verifier ${verifierAddr} --subject ${subjectAddr} --credential_id ${credentialId} --requested_fields '["full_name", "date_of_birth"]'`;
    const requestOut = runCmd(requestCmd);
    console.log(requestOut);

    // Request ID is 1
    const requestId = 1;

    // 5. Grant Access (Subject)
    console.log("\n--- Granting Access ---");
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600; // 1 hour expiry
    const grantCmd = `stellar contract invoke --id ${ACCESS_ID} --source vouchsafe_subject --network testnet -- grant_access --subject ${subjectAddr} --request_id ${requestId} --expiry ${expiry}`;
    const grantOut = runCmd(grantCmd);
    console.log(grantOut);

    // 6. Verify Disclosure - Success Case
    console.log("\n--- Verifying Disclosure (Success) ---");
    // Proof for full_name (leaf0): sibling is leaf1, level 1 sibling is parent1
    const proof0 = [leaf1.toString('hex'), parent1.toString('hex')];
    // Proof for date_of_birth (leaf1): sibling is leaf0, level 1 sibling is parent1
    const proof1 = [leaf0.toString('hex'), parent1.toString('hex')];

    const disclosedFieldsSuccess = [
        {
            name: "full_name",
            value: Buffer.from("Alice Smith", 'utf8').toString('hex'),
            salt: salt0.toString('hex'),
            proof: proof0
        },
        {
            name: "date_of_birth",
            value: Buffer.from("1990-01-01", 'utf8').toString('hex'),
            salt: salt1.toString('hex'),
            proof: proof1
        }
    ];

    const verifySuccessCmd = `stellar contract invoke --id ${ACCESS_ID} --source vouchsafe_verifier --network testnet -- verify_disclosure --request_id ${requestId} --disclosed '${JSON.stringify(disclosedFieldsSuccess)}'`;
    const verifySuccessOut = runCmd(verifySuccessCmd);
    console.log("Success Verification Output:", verifySuccessOut);

    // 7. Verify Disclosure - Failure Case (Tampered Salt)
    console.log("\n--- Verifying Disclosure (Failure with Tampered Salt) ---");
    const tamperedSalt = nodeCrypto.randomBytes(32);
    const disclosedFieldsFailure = [
        {
            name: "full_name",
            value: Buffer.from("Alice Smith", 'utf8').toString('hex'),
            salt: tamperedSalt.toString('hex'), // Tampered salt
            proof: proof0
        }
    ];

    const verifyFailureCmd = `stellar contract invoke --id ${ACCESS_ID} --source vouchsafe_verifier --network testnet -- verify_disclosure --request_id ${requestId} --disclosed '${JSON.stringify(disclosedFieldsFailure)}'`;
    const verifyFailureOut = runCmd(verifyFailureCmd);
    console.log("Failure Verification Output:", verifyFailureOut);
}

main().catch(err => {
    console.error("Execution failed:", err);
});
