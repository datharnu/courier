// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";

/// @notice The current prekey bundle for an account.
/// @dev State holds the keccak256 of the canonical bundle and its expiry. The ML-DSA signature
/// is checked here and then left in the transaction and in `Published`: it is 4,627 bytes, and
/// copying it into storage would be about 145 slots on top of a check the precompile already did.
/// The signed message is the one `BundleSpike.publish` ran on testnet:
/// `abi.encode(chainid, this, owner, bundleHash, expiry)`.
contract PrekeyDirectory {
    uint256 public constant MAX_TTL = 7 days;

    struct Record {
        bytes32 hash;
        uint256 expiry;
    }

    mapping(address => Record) private records;

    event Published(address indexed owner, bytes32 indexed bundleHash, uint256 expiry, bytes signature);

    error ZeroHash();
    error Expired(uint256 expiry);
    error ExpiryTooFar(uint256 expiry);

    function signingMessage(address owner, bytes32 bundleHash, uint256 expiry) public view returns (bytes memory) {
        return abi.encode(block.chainid, address(this), owner, bundleHash, expiry);
    }

    /// @notice Replace the caller's current bundle. An older hash is no longer current.
    function publish(bytes32 bundleHash, uint256 expiry, bytes calldata signature) external {
        if (bundleHash == bytes32(0)) revert ZeroHash();
        if (expiry < block.timestamp) revert Expired(expiry);
        if (expiry > block.timestamp + MAX_TTL) revert ExpiryTooFar(expiry);
        PqAuth.verify(msg.sender, signingMessage(msg.sender, bundleHash, expiry), signature);
        records[msg.sender] = Record({hash: bundleHash, expiry: expiry});
        emit Published(msg.sender, bundleHash, expiry, signature);
    }

    /// @notice `live` is false when the account has never published, and when the bundle is past its expiry.
    /// The hash of an expired bundle is still returned so a client can say "expired".
    function current(address owner) external view returns (bytes32 hash, uint256 expiry, bool live) {
        Record storage record = records[owner];
        hash = record.hash;
        expiry = record.expiry;
        live = hash != bytes32(0) && expiry >= block.timestamp;
    }
}
