// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqTestBase} from "haven-pq-kit-test/PqTestBase.sol";
import {PrekeyDirectory} from "../src/PrekeyDirectory.sol";

/// @notice Honest publishes mixed with invalid/hostile calls against PrekeyDirectory.
contract PrekeyDirectoryHandler is PqTestBase {
    PrekeyDirectory public immutable dir;
    address public immutable alice;
    address public immutable bob;
    address public immutable unregistered;

    uint256 public hostileAccepted;
    mapping(address => bytes32) public lastHash;
    mapping(address => uint256) public lastExpiry;

    constructor(PrekeyDirectory dir_, address alice_, address bob_, address unregistered_) {
        dir = dir_;
        alice = alice_;
        bob = bob_;
        unregistered = unregistered_;
    }

    function publishValid(uint8 who, bytes32 hash, uint256 ahead) external {
        if (hash == bytes32(0)) return;
        ahead = bound(ahead, 0, dir.MAX_TTL());
        address owner = who % 2 == 0 ? alice : bob;
        uint256 expiry = block.timestamp + ahead;
        bytes memory sig = _sign(owner, dir.signingMessage(owner, hash, expiry));
        vm.prank(owner);
        dir.publish(hash, expiry, sig);
        lastHash[owner] = hash;
        lastExpiry[owner] = expiry;
    }

    function publishForged(bytes32 hash, uint256 ahead) external {
        if (hash == bytes32(0)) return;
        ahead = bound(ahead, 0, dir.MAX_TTL());
        uint256 expiry = block.timestamp + ahead;
        bytes memory sig = _sign(bob, dir.signingMessage(alice, hash, expiry));
        vm.prank(alice);
        try dir.publish(hash, expiry, sig) {
            hostileAccepted += 1;
        } catch {}
    }

    function publishUnregistered(bytes32 hash) external {
        if (hash == bytes32(0)) return;
        vm.prank(unregistered);
        try dir.publish(hash, block.timestamp + 1 days, new bytes(4627)) {
            hostileAccepted += 1;
        } catch {}
    }

    function publishZeroHash() external {
        uint256 expiry = block.timestamp + 1 days;
        bytes memory sig = _sign(alice, dir.signingMessage(alice, bytes32(0), expiry));
        vm.prank(alice);
        try dir.publish(bytes32(0), expiry, sig) {
            hostileAccepted += 1;
        } catch {}
    }

    function publishTooFar(bytes32 hash, uint256 extra) external {
        if (hash == bytes32(0)) return;
        extra = bound(extra, 1, 30 days);
        uint256 expiry = block.timestamp + dir.MAX_TTL() + extra;
        bytes memory sig = _sign(alice, dir.signingMessage(alice, hash, expiry));
        vm.prank(alice);
        try dir.publish(hash, expiry, sig) {
            hostileAccepted += 1;
        } catch {}
    }

    function warpForward(uint256 delta) external {
        delta = bound(delta, 0, 2 days);
        vm.warp(block.timestamp + delta);
    }
}

contract PrekeyDirectoryInvariant is PqTestBase {
    PrekeyDirectory internal dir;
    PrekeyDirectoryHandler internal handler;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal unregistered = address(0xDEAD);

    function setUp() public override {
        super.setUp();
        _register(alice);
        _register(bob);
        dir = new PrekeyDirectory();
        handler = new PrekeyDirectoryHandler(dir, alice, bob, unregistered);
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.publishValid.selector;
        selectors[1] = handler.publishForged.selector;
        selectors[2] = handler.publishUnregistered.selector;
        selectors[3] = handler.publishZeroHash.selector;
        selectors[4] = handler.publishTooFar.selector;
        selectors[5] = handler.warpForward.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_noHostilePublishAccepted() public view {
        assertEq(handler.hostileAccepted(), 0);
    }

    function invariant_unregisteredNeverHasBundle() public view {
        (bytes32 hash, uint256 expiry, bool live) = dir.current(unregistered);
        assertEq(hash, bytes32(0));
        assertEq(expiry, 0);
        assertFalse(live);
    }

    function invariant_recordsMatchLastValidPublishAndLiveness() public view {
        address[2] memory owners = [alice, bob];
        for (uint256 i = 0; i < owners.length; i++) {
            address owner = owners[i];
            (bytes32 hash, uint256 expiry, bool live) = dir.current(owner);
            assertEq(hash, handler.lastHash(owner));
            assertEq(expiry, handler.lastExpiry(owner));
            assertEq(live, hash != bytes32(0) && expiry >= block.timestamp);
        }
    }
}
